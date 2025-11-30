export enum Sender {
  USER = 'USER',
  AI = 'AI'
}

export interface Message {
  id: string;
  text: string;
  sender: Sender;
  timestamp: number;
  isAudioPlaying?: boolean;
}

export interface ChatState {
  messages: Message[];
  isLoading: boolean;
  isAudioEnabled: boolean;
}

export interface Contact {
  id: string;
  name: string;
  phoneNumber: string;
}