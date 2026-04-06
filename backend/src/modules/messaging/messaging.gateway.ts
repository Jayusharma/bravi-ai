import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: '*',  // Allow all origins (dev only!)
  },
})
export class PlaygroundGateway implements OnGatewayConnection, OnGatewayDisconnect {
  
  @WebSocketServer()
  server: Server;
  private readonly logger = new Logger('PlaygroundGateway');
  // Called automatically when a client connects
  handleConnection(client: Socket) {
    this.logger.log(`🔌 Client connected: ${client.id}`);
  }
  // Called automatically when a client disconnects
  handleDisconnect(client: Socket) {
    this.logger.log(`🔌 Client disconnected: ${client.id}`);
  }
}