import { GoogleGenAI, Chat, Modality, LiveServerMessage, FunctionDeclaration, Type } from "@google/genai";
import { AMA_SYSTEM_INSTRUCTION, CHAT_MODEL_NAME, TTS_MODEL_NAME, VOICE_NAME } from '../constants';
import { Contact } from '../types';

// Initialize the API client
// CRITICAL: process.env.API_KEY is automatically injected.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

let chatSession: Chat | null = null;

// Tool Definition for calling
const makePhoneCallTool: FunctionDeclaration = {
  name: 'makePhoneCall',
  description: 'Initiates a phone call to a specific phone number using the device dialer.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      phoneNumber: {
        type: Type.STRING,
        description: 'The phone number to call (e.g., 555-1234).',
      },
    },
    required: ['phoneNumber'],
  },
};

const getSystemInstructionWithContacts = (contacts: Contact[] = []) => {
    let instruction = AMA_SYSTEM_INSTRUCTION;
    if (contacts.length > 0) {
        const contactList = contacts.map(c => `${c.name}: ${c.phoneNumber}`).join('\n');
        instruction += `\n\nUSER'S CONTACT BOOK:\n${contactList}\n\nIMPORTANT: If the user asks to call a specific name (e.g., "Call Mom"), look up the number in the contact book above and use the 'makePhoneCall' tool with that number. If the name is not found, ask the user for the number.`;
    }
    instruction += `\n\nIMPORTANT NOTE ON CALLS: If the user asks you to ANSWER an incoming call, explain that due to iPhone security restrictions, you cannot physically intercept or pick up the call for them, but you can help them prepare for it or draft a text response.`;
    return instruction;
};

export const initializeChat = (contacts: Contact[] = []) => {
  chatSession = ai.chats.create({
    model: CHAT_MODEL_NAME,
    config: {
      systemInstruction: getSystemInstructionWithContacts(contacts),
    },
  });
  return chatSession;
};

export const sendMessageToGemini = async (message: string): Promise<string> => {
  if (!chatSession) {
    initializeChat();
  }
  
  try {
    const result = await chatSession!.sendMessage({ message });
    const text = result.text;
    if (!text) {
        throw new Error("No text response received from Gemini.");
    }
    return text;
  } catch (error) {
    console.error("Error sending message to Gemini:", error);
    throw error;
  }
};

export const generateSpeech = async (text: string): Promise<string | null> => {
  try {
    const response = await ai.models.generateContent({
      model: TTS_MODEL_NAME,
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: VOICE_NAME },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio || null;
  } catch (error) {
    console.error("Error generating speech:", error);
    return null;
  }
};

// Live API Connection
export const connectLiveSession = (
    contacts: Contact[],
    callbacks: {
    onopen?: () => void;
    onmessage: (message: LiveServerMessage) => void;
    onerror?: (e: ErrorEvent) => void;
    onclose?: (e: CloseEvent) => void;
}) => {
    return ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks,
        config: {
            systemInstruction: getSystemInstructionWithContacts(contacts),
            responseModalities: [Modality.AUDIO],
            speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } }
            },
            inputAudioTranscription: {}, // Enable user transcription
            outputAudioTranscription: {}, // Enable model transcription
            tools: [{ functionDeclarations: [makePhoneCallTool] }], // Add calling tool
        }
    });
};