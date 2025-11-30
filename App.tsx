import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Message, Sender, Contact } from './types';
import ChatBubble from './components/ChatBubble';
import InputArea from './components/InputArea';
import { initializeChat, sendMessageToGemini, generateSpeech, connectLiveSession } from './services/geminiService';
import { decodeAudioData, float32ToInt16PCM, encodeBase64 } from './services/audioUtils';
import { LiveServerMessage } from '@google/genai';

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAudioEnabled, setIsAudioEnabled] = useState(false);
  const [isListening, setIsListening] = useState(false);
  
  // Contacts State
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showContacts, setShowContacts] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [newContactNumber, setNewContactNumber] = useState('');

  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [currentAudioSource, setCurrentAudioSource] = useState<AudioBufferSourceNode | null>(null);
  
  // Refs for Live API state
  const liveSessionRef = useRef<any>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Buffer for transcriptions
  const currentTurnUserRef = useRef<string>('');
  const currentTurnModelRef = useRef<string>('');
  const currentTurnUserMsgIdRef = useRef<string | null>(null);
  const currentTurnModelMsgIdRef = useRef<string | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isListening]);

  // Load Contacts from LocalStorage
  useEffect(() => {
    const saved = localStorage.getItem('ama_contacts');
    if (saved) {
        try {
            setContacts(JSON.parse(saved));
        } catch (e) {
            console.error("Failed to load contacts", e);
        }
    }
  }, []);

  // Save Contacts
  const saveContact = () => {
      if (newContactName.trim() && newContactNumber.trim()) {
          const newContact: Contact = {
              id: Date.now().toString(),
              name: newContactName.trim(),
              phoneNumber: newContactNumber.trim()
          };
          const updated = [...contacts, newContact];
          setContacts(updated);
          localStorage.setItem('ama_contacts', JSON.stringify(updated));
          setNewContactName('');
          setNewContactNumber('');
          // Re-init chat to update system prompt context
          initializeChat(updated);
      }
  };

  const deleteContact = (id: string) => {
      const updated = contacts.filter(c => c.id !== id);
      setContacts(updated);
      localStorage.setItem('ama_contacts', JSON.stringify(updated));
      initializeChat(updated);
  };

  // Initialize Chat on load
  useEffect(() => {
    initializeChat(contacts);
    
    setMessages([{
        id: 'init',
        text: "Hello. I am Ama. I'm here to support you with insights on AI, cybersecurity, or whatever else is on your mind. You can add your contacts in the menu if you'd like me to call people for you.",
        sender: Sender.AI,
        timestamp: Date.now()
    }]);

    const initAudio = () => {
        if (!audioContext) {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            setAudioContext(ctx);
            setIsAudioEnabled(true);
        }
    };

    window.addEventListener('click', initAudio, { once: true });
    window.addEventListener('keydown', initAudio, { once: true });

    return () => {
         window.removeEventListener('click', initAudio);
         window.removeEventListener('keydown', initAudio);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); 

  // --- Normal Chat Audio Playback ---
  const playAudioResponse = useCallback(async (base64Audio: string, messageId: string) => {
    if (!audioContext) return;
    
    if (currentAudioSource) {
        try { currentAudioSource.stop(); } catch (e) {}
    }
    audioSourcesRef.current.forEach(s => { try{ s.stop(); } catch(e){} });
    audioSourcesRef.current.clear();

    try {
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        const audioBuffer = await decodeAudioData(base64Audio, audioContext);
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);
        
        setMessages(prev => prev.map(m => m.id === messageId ? { ...m, isAudioPlaying: true } : { ...m, isAudioPlaying: false }));

        source.onended = () => {
             setMessages(prev => prev.map(m => m.id === messageId ? { ...m, isAudioPlaying: false } : m));
             setCurrentAudioSource(null);
        };

        source.start();
        setCurrentAudioSource(source);

    } catch (error) {
        console.error("Failed to play audio", error);
    }
  }, [audioContext, currentAudioSource]);

  const handleSendMessage = async (text: string) => {
    if (isListening) {
        stopLiveSession();
    }

    const userMsgId = Date.now().toString();
    const newUserMsg: Message = {
      id: userMsgId,
      text: text,
      sender: Sender.USER,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, newUserMsg]);
    setIsLoading(true);

    try {
        const responseText = await sendMessageToGemini(text);
        
        const aiMsgId = (Date.now() + 1).toString();
        const newAiMsg: Message = {
            id: aiMsgId,
            text: responseText,
            sender: Sender.AI,
            timestamp: Date.now(),
        };
        
        setMessages((prev) => [...prev, newAiMsg]);
        setIsLoading(false);

        if (isAudioEnabled && audioContext) {
             const audioBase64 = await generateSpeech(responseText);
             if (audioBase64) {
                 await playAudioResponse(audioBase64, aiMsgId);
             }
        }

    } catch (error) {
        console.error("Interaction failed:", error);
        setMessages((prev) => [...prev, {
            id: Date.now().toString(),
            text: "I apologize, but I'm having trouble connecting right now. Please try again.",
            sender: Sender.AI,
            timestamp: Date.now()
        }]);
        setIsLoading(false);
    }
  };

  const toggleMute = () => {
      if (currentAudioSource) {
          currentAudioSource.stop();
          setCurrentAudioSource(null);
          setMessages(prev => prev.map(m => ({ ...m, isAudioPlaying: false })));
      }
      setIsAudioEnabled(!isAudioEnabled);
  };

  // --- Live API Logic ---
  const stopLiveSession = useCallback(() => {
      liveSessionRef.current = null;

      if (scriptProcessorRef.current) {
          scriptProcessorRef.current.disconnect();
          scriptProcessorRef.current = null;
      }
      if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach(track => track.stop());
          mediaStreamRef.current = null;
      }
      if (inputAudioContextRef.current) {
          inputAudioContextRef.current.close();
          inputAudioContextRef.current = null;
      }

      audioSourcesRef.current.forEach(source => {
          try { source.stop(); } catch(e){}
      });
      audioSourcesRef.current.clear();
      nextStartTimeRef.current = 0;

      setIsListening(false);
      
      currentTurnUserRef.current = '';
      currentTurnModelRef.current = '';
      currentTurnUserMsgIdRef.current = null;
      currentTurnModelMsgIdRef.current = null;
  }, []);

  const startLiveSession = async () => {
      try {
          setIsListening(true);
          inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
          
          const updateOrAddMessage = (idRef: React.MutableRefObject<string | null>, text: string, sender: Sender, isFinal: boolean = false) => {
              setMessages(prev => {
                  const existingIdx = prev.findIndex(m => m.id === idRef.current);
                  if (existingIdx !== -1) {
                      const newMessages = [...prev];
                      newMessages[existingIdx] = { ...newMessages[existingIdx], text: text };
                      return newMessages;
                  } else {
                      const newId = Date.now().toString() + (sender === Sender.USER ? '-user' : '-ai');
                      idRef.current = newId;
                      return [...prev, {
                          id: newId,
                          text: text,
                          sender: sender,
                          timestamp: Date.now(),
                          isAudioPlaying: sender === Sender.AI 
                      }];
                  }
              });
              
              if (isFinal) {
                  idRef.current = null;
              }
          };

          // PASS CONTACTS HERE so the model knows them
          const liveSessionPromise = connectLiveSession(contacts, {
              onopen: async () => {
                  console.log("Live session connected");
                  try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    mediaStreamRef.current = stream;
                    
                    const inputCtx = inputAudioContextRef.current;
                    if (!inputCtx) return;

                    const source = inputCtx.createMediaStreamSource(stream);
                    const processor = inputCtx.createScriptProcessor(4096, 1, 1);
                    scriptProcessorRef.current = processor;

                    processor.onaudioprocess = (e) => {
                        const inputData = e.inputBuffer.getChannelData(0);
                        const pcm16 = float32ToInt16PCM(inputData);
                        const base64Data = encodeBase64(new Uint8Array(pcm16.buffer));
                        
                        liveSessionPromise.then(session => {
                            session.sendRealtimeInput({
                                media: {
                                    mimeType: 'audio/pcm;rate=16000',
                                    data: base64Data
                                }
                            });
                        });
                    };

                    source.connect(processor);
                    processor.connect(inputCtx.destination);
                  } catch (err) {
                      console.error("Mic error:", err);
                      stopLiveSession();
                  }
              },
              onmessage: async (message: LiveServerMessage) => {
                  if (message.toolCall) {
                      for (const fc of message.toolCall.functionCalls) {
                          if (fc.name === 'makePhoneCall') {
                              const phoneNumber = (fc.args as any).phoneNumber;
                              window.location.href = `tel:${phoneNumber}`;
                              
                              liveSessionPromise.then(session => {
                                  session.sendToolResponse({
                                      functionResponses: {
                                          id: fc.id,
                                          name: fc.name,
                                          response: { result: `Calling ${phoneNumber}...` }
                                      }
                                  });
                              });
                          }
                      }
                  }

                  const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                  if (audioData && audioContext) {
                      if (nextStartTimeRef.current < audioContext.currentTime) {
                          nextStartTimeRef.current = audioContext.currentTime;
                      }

                      try {
                          const audioBuffer = await decodeAudioData(audioData, audioContext);
                          const source = audioContext.createBufferSource();
                          source.buffer = audioBuffer;
                          source.connect(audioContext.destination);
                          
                          source.start(nextStartTimeRef.current);
                          nextStartTimeRef.current += audioBuffer.duration;
                          
                          audioSourcesRef.current.add(source);
                          source.onended = () => audioSourcesRef.current.delete(source);
                      } catch (e) {
                          console.error("Audio decode error", e);
                      }
                  }

                  if (message.serverContent?.inputTranscription) {
                      const text = message.serverContent.inputTranscription.text;
                      if (text) {
                        currentTurnUserRef.current += text;
                        updateOrAddMessage(currentTurnUserMsgIdRef, currentTurnUserRef.current, Sender.USER);
                      }
                  }
                  
                  if (message.serverContent?.outputTranscription) {
                      const text = message.serverContent.outputTranscription.text;
                      if (text) {
                        currentTurnModelRef.current += text;
                        updateOrAddMessage(currentTurnModelMsgIdRef, currentTurnModelRef.current, Sender.AI);
                      }
                  }

                  if (message.serverContent?.turnComplete) {
                      if (currentTurnUserRef.current) {
                          updateOrAddMessage(currentTurnUserMsgIdRef, currentTurnUserRef.current, Sender.USER, true);
                          currentTurnUserRef.current = '';
                      }
                      if (currentTurnModelRef.current) {
                           setMessages(prev => prev.map(m => m.id === currentTurnModelMsgIdRef.current ? { ...m, isAudioPlaying: false } : m));
                           updateOrAddMessage(currentTurnModelMsgIdRef, currentTurnModelRef.current, Sender.AI, true);
                           currentTurnModelRef.current = '';
                      }
                  }
                  
                  if (message.serverContent?.interrupted) {
                      audioSourcesRef.current.forEach(s => s.stop());
                      audioSourcesRef.current.clear();
                      nextStartTimeRef.current = 0;
                      currentTurnModelRef.current = ''; 
                      if (currentTurnModelMsgIdRef.current) {
                           setMessages(prev => prev.map(m => m.id === currentTurnModelMsgIdRef.current ? { ...m, isAudioPlaying: false } : m));
                           currentTurnModelMsgIdRef.current = null;
                      }
                  }
              },
              onclose: () => {
                  console.log("Live session closed");
                  stopLiveSession();
              },
              onerror: (e) => {
                  console.error("Live session error", e);
                   setMessages(prev => [...prev, {
                      id: Date.now().toString(),
                      text: "Connection error: The live service is temporarily unavailable. Please try again or type your message.",
                      sender: Sender.AI,
                      timestamp: Date.now()
                  }]);
                  stopLiveSession();
              }
          });
          
          liveSessionRef.current = liveSessionPromise;

      } catch (e) {
          console.error("Failed to start live session", e);
          setIsListening(false);
          setMessages(prev => [...prev, {
                id: Date.now().toString(),
                text: "Could not start voice mode.",
                sender: Sender.AI,
                timestamp: Date.now()
          }]);
      }
  };

  const handleMicToggle = () => {
      if (isListening) {
          stopLiveSession();
      } else {
          if (!audioContext) {
             const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
             setAudioContext(ctx);
          }
          if (audioContext && audioContext.state === 'suspended') {
              audioContext.resume();
          }
          startLiveSession();
      }
  };


  return (
    <div className="flex flex-col h-screen bg-slate-900 text-slate-100 overflow-hidden relative safe-top safe-bottom">
      
      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
         <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-cyan-900/20 blur-[100px]"></div>
         <div className="absolute top-[40%] -right-[10%] w-[40%] h-[60%] rounded-full bg-blue-900/10 blur-[120px]"></div>
         <div className="absolute bottom-[-10%] left-[20%] w-[30%] h-[30%] rounded-full bg-purple-900/20 blur-[80px]"></div>
      </div>

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 z-20 sticky top-0">
        <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all duration-500
                ${isListening ? 'bg-red-500 shadow-red-500/30' : 'bg-gradient-to-tr from-cyan-500 to-purple-600 shadow-cyan-500/20'}`}>
                <span className="font-bold text-lg text-white">
                    {isListening ? (
                         <span className="flex space-x-0.5 h-3 items-center">
                            <span className="w-1 h-2 bg-white rounded-full animate-[bounce_1s_infinite]"></span>
                            <span className="w-1 h-3 bg-white rounded-full animate-[bounce_1s_infinite_0.2s]"></span>
                            <span className="w-1 h-2 bg-white rounded-full animate-[bounce_1s_infinite_0.4s]"></span>
                         </span>
                    ) : 'A'}
                </span>
            </div>
            <div>
                <h1 className="font-semibold text-lg tracking-tight">Ama</h1>
                <p className="text-xs text-slate-400 font-medium">
                    {isListening ? 'Listening...' : 'AI Companion'}
                </p>
            </div>
        </div>
        
        <div className="flex gap-2">
            <button
                onClick={() => setShowContacts(true)}
                className="p-2 rounded-full bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-cyan-400 transition-colors"
                title="Manage Contacts"
            >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                    <path d="M19.5 6h-15v9h15V6z" opacity="0.5" />
                    <path fillRule="evenodd" d="M3.375 3C2.339 3 1.5 3.84 1.5 4.875v11.25c0 1.035.84 1.875 1.875 1.875h9.75c1.036 0 1.875-.84 1.875-1.875V4.875C15 3.839 14.16 3 13.125 3h-9.75zm6.094 4.875a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4.5 9.75a.75.75 0 00-.75.75V11.5a.75.75 0 00.75.75 2.25 2.25 0 012.25 2.25H6a.75.75 0 000 1.5h.75c.532 0 1.035.128 1.5.351V15c0-1.657-1.343-3-3-3H4.5z" clipRule="evenodd" />
                    <path d="M16.5 6a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM15 10.5a3 3 0 00-3 3v.75a.75.75 0 00.75.75h4.5a.75.75 0 00.75-.75V13.5a3 3 0 00-3-3z" />
                    <path d="M18.75 15a.75.75 0 000 1.5h1.875a.75.75 0 000-1.5H18.75zM18.75 12a.75.75 0 000 1.5h1.875a.75.75 0 000-1.5H18.75zM18.75 9a.75.75 0 000 1.5h1.875a.75.75 0 000-1.5H18.75z" />
                </svg>
            </button>

            <button 
                onClick={toggleMute}
                className={`p-2 rounded-full transition-colors ${isAudioEnabled ? 'bg-slate-800 text-cyan-400 hover:bg-slate-700' : 'bg-slate-800 text-slate-500 hover:bg-slate-700'}`}
                title={isAudioEnabled ? "Mute Voice" : "Enable Voice"}
            >
                {isAudioEnabled ? (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                        <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zM18.584 5.106a.75.75 0 011.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 11-1.06-1.06 8.25 8.25 0 000-11.668.75.75 0 010-1.06z" />
                    </svg>
                ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                        <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zM17.78 9.22a.75.75 0 10-1.06 1.06L18.44 12l-1.72 1.72a.75.75 0 001.06 1.06l1.72-1.72 1.72 1.72a.75.75 0 101.06-1.06L20.56 12l1.72-1.72a.75.75 0 00-1.06-1.06l-1.72 1.72-1.72-1.72z" />
                    </svg>
                )}
            </button>
        </div>
      </header>

      {/* Contacts Modal */}
      {showContacts && (
          <div className="absolute inset-0 z-50 bg-slate-900/90 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-slate-800 rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl border border-slate-700">
                  <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                      <h2 className="font-semibold text-lg">My Contacts</h2>
                      <button onClick={() => setShowContacts(false)} className="text-slate-400 hover:text-white">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path fillRule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clipRule="evenodd" /></svg>
                      </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                      {contacts.length === 0 && (
                          <p className="text-center text-slate-500 text-sm py-4">No contacts saved yet.</p>
                      )}
                      {contacts.map(contact => (
                          <div key={contact.id} className="flex justify-between items-center bg-slate-700/50 p-3 rounded-lg">
                              <div>
                                  <div className="font-medium text-slate-200">{contact.name}</div>
                                  <div className="text-xs text-slate-400">{contact.phoneNumber}</div>
                              </div>
                              <button onClick={() => deleteContact(contact.id)} className="text-red-400 hover:text-red-300 p-1">
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" /></svg>
                              </button>
                          </div>
                      ))}
                  </div>
                  <div className="p-4 bg-slate-700/30 border-t border-slate-700 space-y-3">
                      <input 
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500"
                        placeholder="Name (e.g. Mom)"
                        value={newContactName}
                        onChange={e => setNewContactName(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <input 
                            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500"
                            placeholder="Phone Number"
                            value={newContactNumber}
                            onChange={e => setNewContactNumber(e.target.value)}
                            type="tel"
                        />
                        <button 
                            onClick={saveContact}
                            disabled={!newContactName.trim() || !newContactNumber.trim()}
                            className="bg-cyan-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Add
                        </button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* Chat Container */}
      <main className="flex-1 overflow-y-auto p-4 z-10 scroll-smooth">
        <div className="max-w-4xl mx-auto space-y-6 pb-4">
          {messages.map((msg) => (
            <ChatBubble key={msg.id} message={msg} />
          ))}
          {isLoading && (
             <div className="flex w-full justify-start animate-pulse">
                <div className="bg-slate-800/50 rounded-2xl rounded-tl-none px-4 py-3 border border-slate-700/50">
                    <div className="flex space-x-1">
                        <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce delay-75"></div>
                        <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce delay-150"></div>
                        <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce delay-300"></div>
                    </div>
                </div>
             </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input Area */}
      <InputArea 
        onSend={handleSendMessage} 
        disabled={isLoading} 
        onMicToggle={handleMicToggle}
        isListening={isListening}
      />
      
      {/* Disclaimer */}
      <div className="text-center pb-2 pt-1 text-[10px] text-slate-600 z-10 safe-bottom">
        Ama is an AI companion. Information provided, especially medical, legal, or financial, should be verified.
      </div>

    </div>
  );
};

export default App;