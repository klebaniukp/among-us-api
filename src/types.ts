// backend/src/types.ts
export interface Player {
    id: number;
    name: string;
    isImpostor: boolean;
    isAlive: boolean;
    tasks: Task[];
    socketId: string;
  }
  
  export interface Task {
    id: number;
    roomNumber: number;
    type: 1 | 2 | 3;
    completed: boolean;
    sequence?: number[];
    shapes?: string[];
  }
  
  export interface GameState {
    players: Player[];
    isGameStarted: boolean;
    totalTasksCompleted: number;
    canCallMeeting: boolean;
    roundStartTime: number | null;
    lastMeetingTime: number | null;
    votes: Record<number, number>;
    meetingInProgress: boolean;
  }
  