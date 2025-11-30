import React from 'react';
import { Message, Sender } from '../types';

interface ChatBubbleProps {
  message: Message;
}

const ChatBubble: React.FC<ChatBubbleProps> = ({ message }) => {
  const isUser = message.sender === Sender.USER;

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} mb-4 animate-fade-in-up`}>
      <div
        className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-5 py-3 shadow-md backdrop-blur-sm 
        ${
          isUser
            ? 'bg-gradient-to-br from-cyan-600 to-blue-600 text-white rounded-tr-none'
            : 'bg-slate-800 border border-slate-700 text-slate-200 rounded-tl-none'
        }`}
      >
        <p className="text-sm md:text-base leading-relaxed whitespace-pre-wrap font-light">
          {message.text}
        </p>
        <div className={`text-[10px] mt-2 opacity-60 flex items-center gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
          <span>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          {!isUser && message.isAudioPlaying && (
             <span className="flex gap-0.5 items-end h-3">
                <span className="w-0.5 h-full bg-cyan-400 animate-[pulse_0.6s_infinite]"></span>
                <span className="w-0.5 h-2/3 bg-cyan-400 animate-[pulse_0.8s_infinite]"></span>
                <span className="w-0.5 h-full bg-cyan-400 animate-[pulse_1.0s_infinite]"></span>
             </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatBubble;
