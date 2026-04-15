import { db } from './db.js';

// Active room timers: roomCode → { intervalId, secondsRemaining }
const roomTimers = new Map();

export function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    // Student joins a room's socket channel
    socket.on('join:room', ({ room_code, student_name, student_email }) => {
      if (!room_code) return;
      socket.join(room_code);
      socket.data.room_code = room_code;
      socket.data.student_email = student_email;

      // Send current room status to this socket
      const room = db.prepare('SELECT * FROM rooms WHERE room_code = ?').get(room_code);
      if (room) {
        const answerCount = db.prepare(
          'SELECT COUNT(*) as n FROM answers WHERE room_id = ?'
        ).get(room.id).n;
        socket.emit('room:status', {
          status: room.status,
          current_step: room.current_step,
          step_started_at: room.step_started_at,
          answer_count: answerCount
        });
      }
    });

    // Student joins their group's socket channel
    socket.on('join:group', ({ group_id, student_email }) => {
      if (!group_id) return;
      socket.join(`group:${group_id}`);
      socket.data.group_id = group_id;
    });

    // Professor controls: advance room (lightweight socket version)
    // Heavyweight actions (grouping, etc.) go through HTTP API
    socket.on('professor:advance', ({ room_code, professor_token }) => {
      const room = db.prepare(
        'SELECT * FROM rooms WHERE room_code = ? AND professor_token = ?'
      ).get(room_code, professor_token);
      if (!room) {
        socket.emit('error', { message: 'Invalid professor token' });
        return;
      }
      // The actual advance logic lives in the HTTP routes; this is just a trigger
      // so the professor's button press is instant even before the HTTP response
      io.to(room_code).emit('room:advancing', {});
    });

    // Professor starts a countdown timer
    socket.on('professor:timer', ({ room_code, duration_seconds, professor_token }) => {
      const room = db.prepare(
        'SELECT * FROM rooms WHERE room_code = ? AND professor_token = ?'
      ).get(room_code, professor_token);
      if (!room) {
        socket.emit('error', { message: 'Invalid professor token' });
        return;
      }
      startRoomTimer(io, room_code, duration_seconds);
    });

    socket.on('disconnect', () => {});
  });
}

// ---------- Helpers for index.js to emit room events ----------

export function emitRoomStatus(io, room_code, room_id) {
  const room = db.prepare('SELECT * FROM rooms WHERE room_code = ?').get(room_code);
  if (!room) return;
  const answerCount = db.prepare(
    'SELECT COUNT(*) as n FROM answers WHERE room_id = ?'
  ).get(room_id).n;
  io.to(room_code).emit('room:status', {
    status: room.status,
    current_step: room.current_step,
    step_started_at: room.step_started_at,
    answer_count: answerCount
  });
}

export function emitGrouped(io, room_code, groups) {
  io.to(room_code).emit('room:grouped', { groups });
}

export function emitStep(io, room_code, stepData) {
  io.to(room_code).emit('room:step', stepData);
}

export function emitComplete(io, room_code) {
  io.to(room_code).emit('room:complete', {});
}

export function emitGroupMessage(io, group_id, message) {
  io.to(`group:${group_id}`).emit('group:message', { message });
}

export function startRoomTimer(io, room_code, duration_seconds) {
  // Clear any existing timer for this room
  if (roomTimers.has(room_code)) {
    clearInterval(roomTimers.get(room_code).intervalId);
  }

  let secondsRemaining = duration_seconds;
  io.to(room_code).emit('room:timer', { seconds_remaining: secondsRemaining });

  const intervalId = setInterval(() => {
    secondsRemaining--;
    io.to(room_code).emit('room:timer', { seconds_remaining: secondsRemaining });
    if (secondsRemaining <= 0) {
      clearInterval(intervalId);
      roomTimers.delete(room_code);
    }
  }, 1000);

  roomTimers.set(room_code, { intervalId, secondsRemaining });
}

export function stopRoomTimer(room_code) {
  if (roomTimers.has(room_code)) {
    clearInterval(roomTimers.get(room_code).intervalId);
    roomTimers.delete(room_code);
  }
}
