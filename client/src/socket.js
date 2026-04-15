import { io } from 'socket.io-client';

// Singleton socket connection
const socket = io('/', { autoConnect: false, transports: ['websocket', 'polling'] });

export default socket;
