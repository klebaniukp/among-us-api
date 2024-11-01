// backend/src/index.ts
import express from 'express';
import { Server } from 'socket.io';
import { createServer } from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import { GameState, Player, Task } from './types';


dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL,
    methods: ['GET', 'POST']
  }
});

const gameState: GameState = {
  players: [],
  isGameStarted: false,
  totalTasksCompleted: 0,
  canCallMeeting: false,
  roundStartTime: null,
  lastMeetingTime: null,
  votes: {},
  meetingInProgress: false
};

function generateTask(taskNumber: number): Task {
  const task: Task = {
    id: Date.now() + Math.random(),
    roomNumber: Math.floor(Math.random() * 12) + 1,
    type: taskNumber as 1 | 2 | 3,
    completed: false
  };

  if (task.type === 1) {
    const sequenceLength = Math.floor(Math.random() * 4) + 1;
    task.sequence = Array.from({ length: sequenceLength }, () => Math.floor(Math.random() * 4));
  } else if (task.type === 2) {
    const shapes = ['triangle', 'square', 'circle', 'pentagon', 'hexagon'];
    task.shapes = Array.from({ length: 4 }, () => shapes[Math.floor(Math.random() * shapes.length)]);
  }

  return task;
}

function assignTasks() {
  gameState.players.forEach(player => {
    if (!player.isImpostor && player.isAlive) {
      player.tasks = [
        generateTask(Math.floor(Math.random() * 3) + 1),
        generateTask(Math.floor(Math.random() * 3) + 1)
      ];
    }
  });
}

function checkGameEnd() {
  const alivePlayers = gameState.players.filter(p => p.isAlive && !p.isImpostor);
  const aliveImpostors = gameState.players.filter(p => p.isAlive && p.isImpostor);

  if (aliveImpostors.length === 0) {
    io.emit('crewmatesWin');
    resetGame();
    return true;
  }

  if (aliveImpostors.length >= alivePlayers.length) {
    io.emit('impostorsWin');
    resetGame();
    return true;
  }

  if (gameState.totalTasksCompleted >= 100) {
    io.emit('crewmatesWin');
    resetGame();
    return true;
  }

  return false;
}

function resetGame() {
  gameState.players = [];
  gameState.isGameStarted = false;
  gameState.totalTasksCompleted = 0;
  gameState.canCallMeeting = false;
  gameState.roundStartTime = null;
  gameState.lastMeetingTime = null;
  gameState.votes = {};
  gameState.meetingInProgress = false;
}

io.on('connection', (socket) => {
  socket.on('joinGame', ({ playerName }) => {
    if (gameState.players.length >= 20) {
      socket.emit('error', { message: 'Game is full' });
      return;
    }

    const newPlayer: Player = {
      id: gameState.players.length + 1,
      name: playerName,
      isImpostor: false,
      isAlive: true,
      tasks: [],
      socketId: socket.id
    };

    gameState.players.push(newPlayer);
    socket.emit('playerJoined', newPlayer);
    io.emit('playersUpdate', gameState.players);
  });

  socket.on('startGame', () => {
    if (gameState.players.length < 3) return;

    const playerIndices = Array.from({ length: gameState.players.length }, (_, i) => i);
    const impostor1Index = Math.floor(Math.random() * playerIndices.length);
    playerIndices.splice(impostor1Index, 1);
    const impostor2Index = Math.floor(Math.random() * playerIndices.length);

    gameState.players[impostor1Index].isImpostor = true;
    gameState.players[impostor2Index].isImpostor = true;

    gameState.isGameStarted = true;
    gameState.roundStartTime = Date.now();
    gameState.canCallMeeting = false;

    setTimeout(() => {
      gameState.canCallMeeting = true;
    }, parseInt(process.env.MEETING_INITIAL_DELAY || '120000'));

    assignTasks();

    io.emit('gameStarted', gameState);
  });

  socket.on('completeTask', ({ playerId, taskId }) => {
    const player = gameState.players.find(p => p.id === playerId);
    if (!player) return;

    const task = player.tasks.find(t => t.id === taskId);
    if (!task || task.completed) return;

    task.completed = true;
    gameState.totalTasksCompleted++;

    io.emit('taskCompleted', { playerId, taskId });
    checkGameEnd();
  });

  socket.on('callMeeting', (playerId) => {
    if (!gameState.canCallMeeting || gameState.meetingInProgress) return;

    gameState.meetingInProgress = true;
    gameState.canCallMeeting = false;
    gameState.votes = {};
    gameState.lastMeetingTime = Date.now();

    io.emit('meetingCalled', playerId);

    setTimeout(() => {
      endMeeting();
    }, parseInt(process.env.MEETING_DURATION || '120000'));
  });

  socket.on('castVote', ({ voterId, targetId }) => {
    if (!gameState.meetingInProgress) return;
    gameState.votes[voterId] = targetId;

    const totalVotes = Object.keys(gameState.votes).length;
    const alivePlayers = gameState.players.filter(p => p.isAlive).length;

    if (totalVotes === alivePlayers) {
      endMeeting();
    }
  });

  socket.on('disconnect', () => {
    const playerIndex = gameState.players.findIndex(p => p.socketId === socket.id);
    if (playerIndex !== -1) {
      gameState.players.splice(playerIndex, 1);
      io.emit('playersUpdate', gameState.players);
    }
  });
});

function endMeeting() {
  if (!gameState.meetingInProgress) return;

  const voteCounts: Record<number, number> = {};
  Object.values(gameState.votes).forEach(targetId => {
    voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
  });

  let maxVotes = 0;
  let ejectedPlayerId: number | null = null;

  Object.entries(voteCounts).forEach(([playerId, votes]) => {
    if (votes > maxVotes) {
      maxVotes = votes;
      ejectedPlayerId = parseInt(playerId);
    }
  });

  if (ejectedPlayerId) {
    const ejectedPlayer = gameState.players.find(p => p.id === ejectedPlayerId);
    if (ejectedPlayer) {
      ejectedPlayer.isAlive = false;
      io.emit('playerEjected', {
        playerId: ejectedPlayerId,
        wasImpostor: ejectedPlayer.isImpostor
      });
    }
  }

  gameState.meetingInProgress = false;
  gameState.votes = {};

  setTimeout(() => {
    gameState.canCallMeeting = true;
  }, parseInt(process.env.MEETING_COOLDOWN || '300000'));

  io.emit('meetingEnded');
  checkGameEnd();
}

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});