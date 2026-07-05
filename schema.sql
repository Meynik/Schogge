create extension if not exists pgcrypto;

create table if not exists public.schogge_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'finished', 'expired')),
  host_player_id uuid,
  game_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 hours'
);

create table if not exists public.schogge_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.schogge_rooms(id) on delete cascade,
  name text not null,
  player_token uuid not null default gen_random_uuid(),
  seat_index integer not null,
  presence_state text not null default 'online' check (presence_state in ('online', 'offline', 'left')),
  last_seen_at timestamptz not null default now(),
  left_at timestamptz,
  created_at timestamptz not null default now(),
  unique (room_id, seat_index)
);

alter table public.schogge_rooms enable row level security;
alter table public.schogge_players enable row level security;

do $$
begin
  alter publication supabase_realtime add table public.schogge_rooms;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.schogge_players;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

drop policy if exists "read rooms" on public.schogge_rooms;
create policy "read rooms" on public.schogge_rooms for select using (true);

drop policy if exists "read players" on public.schogge_players;
create policy "read players" on public.schogge_players for select using (true);

create or replace function public.schogge_random_die()
returns integer
language sql
as $$
  select floor(random() * 6 + 1)::integer;
$$;

create or replace function public.schogge_sort_desc(dice jsonb)
returns integer[]
language sql
immutable
as $$
  select array_agg(value::integer order by value::integer desc)
  from jsonb_array_elements_text(dice) as elem(value);
$$;

create or replace function public.schogge_score(dice jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  sorted integer[];
  key text;
  ones integer;
  category text;
  rank_value integer;
  sips integer := 0;
  label text;
begin
  sorted := public.schogge_sort_desc(dice);
  if array_length(sorted, 1) <> 3 then
    raise exception 'Es werden genau drei Wuerfel erwartet.';
  end if;

  key := array_to_string(sorted, '');
  ones := coalesce((select count(*) from unnest(sorted) die where die = 1), 0);

  if key = '111' then
    category := 'schogge_aus';
    rank_value := 6000;
    label := 'Schogge aus';
  elsif ones = 2 then
    category := 'schogge';
    sips := (select die from unnest(sorted) die where die <> 1 limit 1);
    rank_value := 5000 + sips;
    key := '11' || sips::text;
    label := 'Schogge ' || sips::text;
  elsif sorted[1] = sorted[2] and sorted[2] = sorted[3] then
    category := 'drasch';
    sips := 3;
    rank_value := 4000 + sorted[1];
    label := case sorted[1]
      when 6 then 'Sechser Drasch'
      when 5 then 'Fuenfer Drasch'
      when 4 then 'Vierer Drasch'
      when 3 then 'Dreier Drasch'
      when 2 then 'Zweier Drasch'
      else key
    end;
  elsif key in ('654', '543', '432', '321') then
    category := 'strasse';
    sips := 2;
    rank_value := 3000 + case key when '321' then 1 when '432' then 2 when '543' then 3 else 4 end;
    label := case key
      when '654' then 'Grosse Strasse'
      when '543' then 'Mittelgrosse Strasse'
      when '432' then 'Mittelkleine Strasse'
      else 'Kleine Strasse'
    end;
  else
    category := 'einfach';
    rank_value := case key when '531' then 1999 else 1000 + key::integer end;
    label := case key when '531' then 'Kurve' else key end;
  end if;

  return jsonb_build_object(
    'category', category,
    'displayDice', key,
    'sortedDice', to_jsonb(sorted),
    'rank', rank_value,
    'schluecke', sips,
    'label', label
  );
end;
$$;

create or replace function public.schogge_apply_double_six(dice jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  values_array integer[] := array(select value::integer from jsonb_array_elements_text(dice) as elem(value));
  six_count integer;
  first_six integer := 0;
  next_values integer[];
  held boolean[] := array[]::boolean[];
  must_reroll integer[] := array[]::integer[];
  i integer;
  display_text text;
begin
  six_count := coalesce((select count(*) from unnest(values_array) die where die = 6), 0);
  if six_count < 2 then
    return jsonb_build_object(
      'triggered', false,
      'dice', dice,
      'held', '[false,false,false]'::jsonb,
      'mustRerollIndices', '[]'::jsonb,
      'display', array_to_string(values_array, '')
    );
  end if;

  next_values := values_array;
  for i in 1..3 loop
    if next_values[i] = 6 and first_six = 0 then
      next_values[i] := 1;
      first_six := i;
    end if;
  end loop;

  for i in 1..3 loop
    held := held || (next_values[i] = 1);
    if next_values[i] <> 1 then
      must_reroll := must_reroll || (i - 1);
    end if;
  end loop;

  display_text := array_to_string(public.schogge_sort_desc(to_jsonb(next_values)), '');
  if next_values[1] = 1 or next_values[2] = 1 or next_values[3] = 1 then
    display_text := array_to_string(next_values, '');
  end if;

  return jsonb_build_object(
    'triggered', true,
    'dice', to_jsonb(next_values),
    'held', to_jsonb(held),
    'mustRerollIndices', to_jsonb(must_reroll),
    'display', display_text
  );
end;
$$;

create or replace function public.schogge_room_code()
returns text
language plpgsql
as $$
declare
  code text;
begin
  loop
    code := 'SCHOGGE' || lpad(floor(random() * 10000)::integer::text, 4, '0');
    exit when not exists (select 1 from public.schogge_rooms where schogge_rooms.code = code);
  end loop;
  return code;
end;
$$;

create or replace function public.schogge_new_turn(player_id uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'playerId', player_id,
    'dice', '[null,null,null]'::jsonb,
    'held', '[false,false,false]'::jsonb,
    'actualThrowCount', 0,
    'rollCount', 0,
    'regularRollCount', 0,
    'forceReroll', false,
    'confirmationLocked', false,
    'message', 'Bereit fuer Wurf 1.'
  );
$$;

create or replace function public.schogge_create_room(player_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_name text := left(nullif(trim(player_name), ''), 32);
  new_room schogge_rooms;
  new_player schogge_players;
begin
  if clean_name is null then
    raise exception 'Bitte gib deinen Namen ein.';
  end if;

  insert into public.schogge_rooms(code)
  values (public.schogge_room_code())
  returning * into new_room;

  insert into public.schogge_players(room_id, name, seat_index)
  values (new_room.id, clean_name, 0)
  returning * into new_player;

  update public.schogge_rooms
  set host_player_id = new_player.id, updated_at = now()
  where id = new_room.id
  returning * into new_room;

  return jsonb_build_object(
    'room_id', new_room.id,
    'room_code', new_room.code,
    'room_status', new_room.status,
    'player_id', new_player.id,
    'player_token', new_player.player_token
  );
end;
$$;

create or replace function public.schogge_join_room(room_code text, player_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_name text := left(nullif(trim(player_name), ''), 32);
  clean_code text := upper(regexp_replace(coalesce(room_code, ''), '\s+', '', 'g'));
  target_room schogge_rooms;
  new_player schogge_players;
  next_seat integer;
begin
  if clean_name is null then
    raise exception 'Bitte gib deinen Namen ein.';
  end if;

  select * into target_room
  from public.schogge_rooms
  where code = clean_code and expires_at > now()
  for update;

  if target_room.id is null then
    raise exception 'Dieser Raumcode existiert nicht.';
  end if;
  if target_room.status <> 'lobby' then
    raise exception 'Diese Runde laeuft bereits.';
  end if;
  if (select count(*) from public.schogge_players where room_id = target_room.id and presence_state <> 'left') >= 6 then
    raise exception 'Dieser Raum ist voll.';
  end if;

  select coalesce(max(seat_index), -1) + 1 into next_seat
  from public.schogge_players
  where room_id = target_room.id;

  insert into public.schogge_players(room_id, name, seat_index)
  values (target_room.id, clean_name, next_seat)
  returning * into new_player;

  update public.schogge_rooms set updated_at = now() where id = target_room.id;

  return jsonb_build_object(
    'room_id', target_room.id,
    'room_code', target_room.code,
    'room_status', target_room.status,
    'player_id', new_player.id,
    'player_token', new_player.player_token
  );
end;
$$;

create or replace function public.schogge_assert_player(room_id uuid, player_id uuid, player_token uuid)
returns schogge_players
language plpgsql
security definer
set search_path = public
as $$
declare
  player_row schogge_players;
begin
  select * into player_row
  from public.schogge_players
  where schogge_players.id = $2
    and schogge_players.room_id = $1
    and schogge_players.player_token = $3
    and schogge_players.presence_state <> 'left';
  if player_row.id is null then
    raise exception 'Du bist nicht mehr in diesem Raum.';
  end if;
  update public.schogge_players set presence_state = 'online', last_seen_at = now() where id = player_row.id;
  return player_row;
end;
$$;

create or replace function public.schogge_touch_presence(player_id uuid, player_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.schogge_players
  set presence_state = 'online', last_seen_at = now()
  where schogge_players.id = $1
    and schogge_players.player_token = $2
    and schogge_players.presence_state <> 'left';
end;
$$;

create or replace function public.schogge_start_game(room_id uuid, player_id uuid, player_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  room_row schogge_rooms;
  player_row schogge_players;
  players_json jsonb;
  starter uuid;
  game jsonb;
begin
  player_row := public.schogge_assert_player(room_id, player_id, player_token);
  select * into room_row from public.schogge_rooms where id = room_id for update;
  if room_row.host_player_id <> player_id then
    raise exception 'Nur der Host darf das Spiel starten.';
  end if;
  if room_row.status <> 'lobby' then
    raise exception 'Das Spiel wurde bereits gestartet.';
  end if;
  if (select count(*) from public.schogge_players where room_id = room_row.id and presence_state <> 'left') < 2 then
    raise exception 'Mindestens zwei Spieler sind erforderlich.';
  end if;

  select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by seat_index), min(id)
  into players_json, starter
  from public.schogge_players
  where room_id = room_row.id and presence_state <> 'left';

  starter := (select id from public.schogge_players where room_id = room_row.id and presence_state <> 'left' order by random() limit 1);

  game := jsonb_build_object(
    'players', players_json,
    'roundNumber', 1,
    'pot', 0,
    'nextStarterId', starter,
    'screen', 'roundStart',
    'currentRound', null,
    'currentTurn', null,
    'lastResult', null,
    'lastRound', null
  );

  update public.schogge_rooms
  set status = 'playing', game_state = game, updated_at = now()
  where id = room_row.id;

  return game;
end;
$$;

create or replace function public.schogge_begin_round(room_id uuid, player_id uuid, player_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  room_row schogge_rooms;
  game jsonb;
  starter uuid;
  order_ids uuid[];
  round_json jsonb;
begin
  perform public.schogge_assert_player(room_id, player_id, player_token);
  select * into room_row from public.schogge_rooms where id = room_id for update;
  if room_row.status <> 'playing' then
    raise exception 'Das Spiel laeuft nicht.';
  end if;
  game := room_row.game_state;
  starter := (game->>'nextStarterId')::uuid;
  if player_id <> starter and player_id <> room_row.host_player_id then
    raise exception 'Nur der Startspieler oder Host darf die Runde starten.';
  end if;

  select array_agg(id order by sort_order) into order_ids
  from (
    select id,
      case when seat_index >= (select seat_index from public.schogge_players where id = starter)
        then seat_index
        else seat_index + 100
      end as sort_order
    from public.schogge_players
    where room_id = room_row.id and presence_state <> 'left'
  ) ordered_players;

  round_json := jsonb_build_object(
    'number', coalesce((game->>'roundNumber')::integer, 1),
    'startPlayerId', starter,
    'startPlayerName', (select name from public.schogge_players where id = starter),
    'regularLimit', null,
    'turnOrder', to_jsonb(order_ids),
    'currentTurnIndex', 0,
    'results', '[]'::jsonb,
    'schoggeAusCount', 0,
    'potFrozen', false,
    'immediateAus', null,
    'outcome', null
  );

  game := jsonb_set(game, '{currentRound}', round_json);
  game := jsonb_set(game, '{currentTurn}', public.schogge_new_turn(order_ids[1]));
  game := jsonb_set(game, '{screen}', '"turn"');
  update public.schogge_rooms set game_state = game, updated_at = now() where id = room_row.id;
  return game;
end;
$$;

create or replace function public.schogge_toggle_die(room_id uuid, player_id uuid, player_token uuid, die_index integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  room_row schogge_rooms;
  game jsonb;
  turn jsonb;
  held jsonb;
  current_value boolean;
begin
  perform public.schogge_assert_player(room_id, player_id, player_token);
  select * into room_row from public.schogge_rooms where id = room_id for update;
  game := room_row.game_state;
  turn := game->'currentTurn';
  if game->>'screen' <> 'turn' or turn->>'playerId' <> player_id::text then
    raise exception 'Du bist nicht am Zug.';
  end if;
  if coalesce((turn->>'forceReroll')::boolean, false) then
    raise exception 'Beim Pflichtwurf duerfen keine Wuerfel gehalten werden.';
  end if;
  if die_index < 0 or die_index > 2 or (turn->'dice'->die_index) = 'null'::jsonb then
    raise exception 'Dieser Wuerfel kann nicht gehalten werden.';
  end if;
  held := turn->'held';
  current_value := coalesce((held->>die_index)::boolean, false);
  held := jsonb_set(held, array[die_index::text], to_jsonb(not current_value));
  turn := jsonb_set(turn, '{held}', held);
  game := jsonb_set(game, '{currentTurn}', turn);
  update public.schogge_rooms set game_state = game, updated_at = now() where id = room_row.id;
  return game;
end;
$$;

create or replace function public.schogge_roll(room_id uuid, player_id uuid, player_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  room_row schogge_rooms;
  game jsonb;
  round_json jsonb;
  turn jsonb;
  dice integer[] := array[]::integer[];
  held boolean[] := array[]::boolean[];
  was_forced boolean;
  actual_count integer;
  regular_count integer;
  limit_count integer;
  i integer;
  final_dice integer[] := array[]::integer[];
  double_six jsonb;
  score jsonb;
begin
  perform public.schogge_assert_player(room_id, player_id, player_token);
  select * into room_row from public.schogge_rooms where id = room_id for update;
  game := room_row.game_state;
  round_json := game->'currentRound';
  turn := game->'currentTurn';
  if game->>'screen' <> 'turn' or turn->>'playerId' <> player_id::text then
    raise exception 'Du bist nicht am Zug.';
  end if;

  was_forced := coalesce((turn->>'forceReroll')::boolean, false);
  actual_count := coalesce((turn->>'actualThrowCount')::integer, 0);
  regular_count := coalesce((turn->>'regularRollCount')::integer, 0);
  limit_count := coalesce((round_json->>'regularLimit')::integer, 3);

  if not was_forced and actual_count >= limit_count then
    raise exception 'Das Wurflimit ist erreicht.';
  end if;

  for i in 0..2 loop
    dice := dice || coalesce((turn->'dice'->>i)::integer, 0);
    held := held || coalesce((turn->'held'->>i)::boolean, false);
  end loop;

  for i in 1..3 loop
    if was_forced and dice[i] = 1 then
      final_dice := final_dice || dice[i];
    elsif not was_forced and held[i] and dice[i] <> 0 then
      final_dice := final_dice || dice[i];
    else
      final_dice := final_dice || public.schogge_random_die();
    end if;
  end loop;

  actual_count := actual_count + 1;
  if not was_forced then
    regular_count := regular_count + 1;
  end if;

  turn := jsonb_set(turn, '{dice}', to_jsonb(final_dice));
  turn := jsonb_set(turn, '{actualThrowCount}', to_jsonb(actual_count));
  turn := jsonb_set(turn, '{rollCount}', to_jsonb(actual_count));
  turn := jsonb_set(turn, '{regularRollCount}', to_jsonb(regular_count));

  double_six := public.schogge_apply_double_six(to_jsonb(final_dice));
  if (double_six->>'triggered')::boolean then
    turn := jsonb_set(turn, '{dice}', double_six->'dice');
    turn := jsonb_set(turn, '{held}', double_six->'held');
    turn := jsonb_set(turn, '{forceReroll}', 'true'::jsonb);
    turn := jsonb_set(turn, '{message}', to_jsonb('Doppel-Sechs: ' || (double_six->>'display') || '. Der Pflichtwurf ist Wurf ' || (actual_count + 1)::text || '.'));
    game := jsonb_set(game, '{currentTurn}', turn);
    update public.schogge_rooms set game_state = game, updated_at = now() where id = room_row.id;
    return game;
  end if;

  turn := jsonb_set(turn, '{forceReroll}', 'false'::jsonb);
  turn := jsonb_set(turn, '{held}', '[false,false,false]'::jsonb);
  turn := jsonb_set(turn, '{message}', to_jsonb(case when actual_count >= limit_count then 'Wurflimit erreicht. Bitte Ergebnis bestaetigen.' else 'Wurf abgeschlossen.' end));
  game := jsonb_set(game, '{currentTurn}', turn);
  score := public.schogge_score(turn->'dice');

  update public.schogge_rooms set game_state = game, updated_at = now() where id = room_row.id;

  if score->>'category' = 'schogge_aus' and actual_count = 1 then
    return public.schogge_accept_turn(room_id, player_id, player_token);
  end if;

  return game;
end;
$$;

create or replace function public.schogge_accept_turn(room_id uuid, player_id uuid, player_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  room_row schogge_rooms;
  game jsonb;
  round_json jsonb;
  turn jsonb;
  score jsonb;
  result_json jsonb;
  results jsonb;
  pot integer;
  pot_before integer;
  pot_change integer := 0;
  special text := null;
  completed_order integer;
  round_done boolean;
  player_name text;
  set_limit integer := null;
begin
  perform public.schogge_assert_player(room_id, player_id, player_token);
  select * into room_row from public.schogge_rooms where id = room_id for update;
  game := room_row.game_state;
  round_json := game->'currentRound';
  turn := game->'currentTurn';
  if game->>'screen' <> 'turn' or turn->>'playerId' <> player_id::text then
    raise exception 'Du bist nicht am Zug.';
  end if;
  if coalesce((turn->>'forceReroll')::boolean, false) then
    raise exception 'Der Pflichtwurf muss zuerst ausgefuehrt werden.';
  end if;

  score := public.schogge_score(turn->'dice');
  pot := coalesce((game->>'pot')::integer, 0);
  pot_before := pot;
  results := coalesce(round_json->'results', '[]'::jsonb);
  completed_order := jsonb_array_length(results) + 1;
  player_name := (select name from public.schogge_players where id = player_id);

  if score->>'category' = 'schogge_aus' and coalesce((turn->>'actualThrowCount')::integer, 0) = 1 then
    special := 'immediate_aus';
    pot := 0;
    round_json := jsonb_set(round_json, '{immediateAus}', jsonb_build_object('playerId', player_id, 'potBefore', pot_before));
  elsif score->>'category' = 'schogge_aus' then
    special := 'regular_aus';
    pot := 0;
    round_json := jsonb_set(round_json, '{schoggeAusCount}', to_jsonb(coalesce((round_json->>'schoggeAusCount')::integer, 0) + 1));
    round_json := jsonb_set(round_json, '{potFrozen}', 'true'::jsonb);
  elsif not coalesce((round_json->>'potFrozen')::boolean, false) then
    pot_change := coalesce((score->>'schluecke')::integer, 0);
    pot := pot + pot_change;
  end if;

  if round_json->>'regularLimit' is null and round_json->>'startPlayerId' = player_id::text and special is distinct from 'immediate_aus' then
    set_limit := least(coalesce((turn->>'actualThrowCount')::integer, 0), 3);
    round_json := jsonb_set(round_json, '{regularLimit}', to_jsonb(set_limit));
  end if;

  result_json := jsonb_build_object(
    'playerId', player_id,
    'playerName', player_name,
    'dice', turn->'dice',
    'held', turn->'held',
    'rollCount', turn->'actualThrowCount',
    'actualThrowCount', turn->'actualThrowCount',
    'regularRollCount', turn->'regularRollCount',
    'completedOrder', completed_order,
    'score', score,
    'potBefore', pot_before,
    'potAfter', pot,
    'potChange', pot_change,
    'special', special,
    'setRoundLimit', set_limit,
    'message', 'Ergebnis uebernommen.'
  );

  results := results || jsonb_build_array(result_json);
  round_json := jsonb_set(round_json, '{results}', results);
  round_done := (round_json->'immediateAus') <> 'null'::jsonb
    or jsonb_array_length(results) >= (select count(*) from public.schogge_players where room_id = room_row.id and presence_state <> 'left');

  game := jsonb_set(game, '{currentRound}', round_json);
  game := jsonb_set(game, '{lastResult}', result_json);
  game := jsonb_set(game, '{currentRoundDone}', to_jsonb(round_done));
  game := jsonb_set(game, '{pot}', to_jsonb(pot));
  game := jsonb_set(game, '{screen}', '"result"');

  update public.schogge_rooms set game_state = game, updated_at = now() where id = room_row.id;
  return game;
end;
$$;

create or replace function public.schogge_finish_round(game jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  round_json jsonb := game->'currentRound';
  results jsonb := round_json->'results';
  worst jsonb;
  losers jsonb;
  outcome jsonb;
  pot integer := coalesce((game->>'pot')::integer, 0);
  schogge_aus_count integer := coalesce((round_json->>'schoggeAusCount')::integer, 0);
  glass_count integer;
  tied_worst integer;
  worst_rank integer;
begin
  select item.value into worst
  from jsonb_array_elements(results) as item(value)
  order by (item.value->'score'->>'rank')::integer asc, (item.value->>'completedOrder')::integer desc
  limit 1;
  worst_rank := (worst->'score'->>'rank')::integer;

  if (round_json->'immediateAus') <> 'null'::jsonb then
    worst := coalesce(
      (select item.value from jsonb_array_elements(results) as item(value)
       where item.value->>'playerId' = round_json->'immediateAus'->>'playerId'
       limit 1),
      worst
    );
    outcome := jsonb_build_object(
      'type', 'immediate_aus',
      'title', 'Schogge aus im ersten Wurf',
      'losers', jsonb_build_array(worst),
      'drinks', (round_json->'immediateAus'->>'potBefore')::integer,
      'multiplier', 1,
      'nextStarterId', worst->>'playerId',
      'potAfter', 0
    );
  elsif schogge_aus_count > 0 then
    glass_count := least(schogge_aus_count, jsonb_array_length(results));
    select jsonb_agg(value) into losers
    from (
      select item.value
      from jsonb_array_elements(results) as item(value)
      order by (item.value->'score'->>'rank')::integer asc, (item.value->>'completedOrder')::integer desc
      limit glass_count
    ) ordered_losers;
    outcome := jsonb_build_object(
      'type', 'glass',
      'title', glass_count::text || ' Glas',
      'losers', losers,
      'glassCount', glass_count,
      'nextStarterId', losers->0->>'playerId',
      'potAfter', 0
    );
  else
    select count(*) into tied_worst
    from jsonb_array_elements(results) as item(value)
    where (item.value->'score'->>'rank')::integer = worst_rank;
    outcome := jsonb_build_object(
      'type', 'sips',
      'title', 'Schlueckerunde',
      'losers', jsonb_build_array(worst),
      'drinks', pot * case when tied_worst > 1 then 2 else 1 end,
      'multiplier', case when tied_worst > 1 then 2 else 1 end,
      'nextStarterId', worst->>'playerId',
      'potAfter', 0
    );
  end if;

  round_json := jsonb_set(round_json, '{outcome}', outcome);
  game := jsonb_set(game, '{lastRound}', round_json);
  game := jsonb_set(game, '{currentRound}', 'null'::jsonb);
  game := jsonb_set(game, '{currentTurn}', 'null'::jsonb);
  game := jsonb_set(game, '{nextStarterId}', to_jsonb(outcome->>'nextStarterId'));
  game := jsonb_set(game, '{pot}', '0'::jsonb);
  game := jsonb_set(game, '{roundNumber}', to_jsonb(coalesce((game->>'roundNumber')::integer, 1) + 1));
  game := jsonb_set(game, '{screen}', '"summary"');
  return game;
end;
$$;

create or replace function public.schogge_continue_after_result(room_id uuid, player_id uuid, player_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  room_row schogge_rooms;
  game jsonb;
  round_json jsonb;
  order_json jsonb;
  next_index integer;
  next_player uuid;
begin
  perform public.schogge_assert_player(room_id, player_id, player_token);
  select * into room_row from public.schogge_rooms where id = room_id for update;
  game := room_row.game_state;
  if game->>'screen' <> 'result' then
    raise exception 'Es gibt kein offenes Zugergebnis.';
  end if;
  if coalesce((game->>'currentRoundDone')::boolean, false) then
    game := public.schogge_finish_round(game);
  else
    round_json := game->'currentRound';
    order_json := round_json->'turnOrder';
    next_index := coalesce((round_json->>'currentTurnIndex')::integer, 0) + 1;
    next_player := (order_json->>next_index)::uuid;
    round_json := jsonb_set(round_json, '{currentTurnIndex}', to_jsonb(next_index));
    game := jsonb_set(game, '{currentRound}', round_json);
    game := jsonb_set(game, '{currentTurn}', public.schogge_new_turn(next_player));
    game := jsonb_set(game, '{screen}', '"turn"');
  end if;
  update public.schogge_rooms set game_state = game, updated_at = now() where id = room_row.id;
  return game;
end;
$$;

create or replace function public.schogge_next_round(room_id uuid, player_id uuid, player_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  room_row schogge_rooms;
  game jsonb;
begin
  perform public.schogge_assert_player(room_id, player_id, player_token);
  select * into room_row from public.schogge_rooms where id = room_id for update;
  if room_row.host_player_id <> player_id then
    raise exception 'Nur der Host darf die naechste Runde starten.';
  end if;
  game := room_row.game_state;
  game := jsonb_set(game, '{screen}', '"roundStart"');
  update public.schogge_rooms set game_state = game, updated_at = now() where id = room_row.id;
  return game;
end;
$$;

create or replace function public.schogge_leave_room(room_id uuid, player_id uuid, player_token uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.schogge_players
  set presence_state = 'left', left_at = now(), last_seen_at = now()
  where schogge_players.room_id = $1
    and schogge_players.id = $2
    and schogge_players.player_token = $3;
end;
$$;

grant select on public.schogge_rooms to anon;
grant select on public.schogge_players to anon;
grant execute on all functions in schema public to anon;
