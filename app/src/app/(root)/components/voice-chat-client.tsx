'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Mic, StopCircle, Ear, LogOut, MicOff } from 'lucide-react';
import Link from 'next/link';
import { useSpeechToSpeech } from '../useSpeechToSpeech';
import { toast } from 'sonner';
import ConversationList from '@/components/conversation-list';
import Messages from '@/components/messages';
import TimerDisplay from './timer-display';
import { EmptyMcpConfig, mcpConfigSchema } from '@/common/schemas';

interface Conversation {
  id: string;
  createdAt: Date;
}

interface VoiceChatProps {
  userId: string;
  initialConversations: Conversation[];
}

export default function VoiceChatClient({ initialConversations, userId }: VoiceChatProps) {
  const conversations = initialConversations;

  const {
    messages,
    isActive,
    isLoading,
    isAssistantSpeaking,
    isMuted,
    startSession,
    closeSession,
    toggleMute,
    errorMessages,
  } = useSpeechToSpeech(userId, (reason) => {
    setEndReason(reason);
    setCompletionModalOpen(true);
  });

  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);

  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const defaultSystemPrompt =
    'You are a language teacher and the user is a student of your lesson. Please help the user learn a language through real-life conversation. ALWAYS respond in a short sentence, in 15~30 words. Your name is Nova.';
  const [systemPrompt, setSystemPrompt] = useState(defaultSystemPrompt);
  const [inputSystemPrompt, setInputSystemPrompt] = useState(systemPrompt);
  const [voiceId, setVoiceId] = useState('tiffany');
  const [mcpConfig, setMcpConfig] = useState(EmptyMcpConfig);
  const [inputMcpConfig, setInputMcpConfig] = useState(JSON.stringify(EmptyMcpConfig, null, 2));
  const [mcpConfigError, setMcpConfigError] = useState<string | null>(null);
  const [completionModalOpen, setCompletionModalOpen] = useState(false);
  const [endReason, setEndReason] = useState('');
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const isActiveRef = useRef(isActive);

  const messagesWithoutSystemPrompt = useMemo(() => {
    return messages.filter((m) => m.role !== 'system');
  }, [messages]);

  const showingMessages = useMemo(() => {
    if (showSystemPrompt) {
      return messages;
    } else {
      return messagesWithoutSystemPrompt;
    }
  }, [messages, messagesWithoutSystemPrompt, showSystemPrompt]);

  const isEmpty = useMemo(() => {
    return messagesWithoutSystemPrompt.length === 0;
  }, [messagesWithoutSystemPrompt]);

  useEffect(() => {
    if (errorMessages.length > 0) {
      toast.error(errorMessages[errorMessages.length - 1]);
    }
  }, [errorMessages]);

  useEffect(() => {
    const savedSystemPrompt = localStorage.getItem('systemPrompt');
    if (savedSystemPrompt) {
      setSystemPrompt(savedSystemPrompt);
      setInputSystemPrompt(savedSystemPrompt);
    }

    const savedMcpConfig = localStorage.getItem('mcpConfig');
    if (savedMcpConfig) {
      try {
        const parsed = JSON.parse(savedMcpConfig);
        const validationResult = mcpConfigSchema.safeParse(parsed);
        if (validationResult.success) {
          setMcpConfig(parsed);
          setInputMcpConfig(savedMcpConfig);
        }
      } catch (error) {
        console.error('Error loading saved MCP config:', error);
      }
    }
  }, []);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    // Scroll to bottom when message is added
    if (scrollAreaRef.current) {
      const scrollElement = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
      }
    }
  }, [showingMessages]);

  useEffect(() => {
    return () => {
      if (isActiveRef.current) {
        closeSession();
      }
    };
  }, [closeSession]);

  useEffect(() => {
    if (isActive && !sessionStartTime) {
      setSessionStartTime(Date.now());
    } else if (!isActive && sessionStartTime) {
      setSessionStartTime(null);
    }
  }, [isActive, sessionStartTime]);

  const handleStartSession = () => {
    startSession(voiceId, systemPrompt, mcpConfig);
  };

  const handleCloseSession = () => {
    closeSession();
  };

  const validateAndSetMcpConfig = (jsonString: string) => {
    // Treat empty string as EmptyMcpConfig
    if (jsonString.trim() === '') {
      setMcpConfigError(null);
      return true;
    }

    try {
      const parsed = JSON.parse(jsonString);
      const validationResult = mcpConfigSchema.safeParse(parsed);

      if (validationResult.success) {
        setMcpConfigError(null);
        return true;
      } else {
        const errorMessage = validationResult.error.issues
          .map((err: any) => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        setMcpConfigError(errorMessage);
        return false;
      }
    } catch (error) {
      setMcpConfigError('Invalid JSON format');
      return false;
    }
  };

  const handleMcpConfigChange = (value: string) => {
    setInputMcpConfig(value);
    validateAndSetMcpConfig(value);
  };

  const handleUpdateMcpConfig = () => {
    if (validateAndSetMcpConfig(inputMcpConfig)) {
      try {
        // Handle empty string as EmptyMcpConfig
        const configToSet = inputMcpConfig.trim() === '' ? EmptyMcpConfig : JSON.parse(inputMcpConfig);
        setMcpConfig(configToSet);
        localStorage.setItem('mcpConfig', inputMcpConfig);
      } catch (error) {
        // This should not happen as validation passed
        console.error('Unexpected error updating MCP config:', error);
      }
    }
  };

  const handleFormatMcpConfig = () => {
    try {
      const parsed = JSON.parse(inputMcpConfig);
      const formatted = JSON.stringify(parsed, null, 2);
      setInputMcpConfig(formatted);
      setMcpConfigError(null);
    } catch (error) {
      setMcpConfigError('Invalid JSON format');
    }
  };

  return (
    <div className="flex h-dvh bg-gray-50">
      {/* Sidebar - Hidden on mobile */}
      <div className="hidden md:block">
        <ConversationList conversations={conversations} />
      </div>

      {/* Main Chat Panel */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 bg-white flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold">Nova Sonic Chat</h1>
            {isActive && <TimerDisplay isActive={isActive} sessionStartTime={sessionStartTime} />}
          </div>
        </div>

        {/* Empty State */}
        {isEmpty && !isLoading && !isActive && (
          <div className="flex-1 flex flex-col items-center justify-center p-8">
            <div className="text-center">
              <div className="w-32 h-32 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                <Mic className="w-16 h-16 text-gray-400" />
              </div>
              <p className="text-gray-600">Ready to start voice conversation</p>
            </div>
          </div>
        )}

        {/* Loading State */}
        {isEmpty && isLoading && (
          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="w-32 h-32 border-8 border-gray-200 border-t-blue-500 rounded-full animate-spin mb-4"></div>
            <p className="text-gray-600">Initializing voice chat...</p>
          </div>
        )}

        {/* Listening State */}
        {isEmpty && !isLoading && isActive && (
          <div className="flex-1 flex flex-col items-center justify-center animate-pulse">
            <Ear className="w-32 h-32 text-blue-500 mb-4" />
            <p className="text-lg text-gray-700">Say Hello to Nova!</p>
          </div>
        )}

        {/* Messages */}
        {!isEmpty && (
          <>
            {/* System Prompt Toggle */}
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center space-x-2">
                <Switch id="system-prompt" checked={showSystemPrompt} onCheckedChange={setShowSystemPrompt} />
                <label htmlFor="system-prompt" className="text-sm font-medium">
                  Show System Prompt
                </label>
              </div>
            </div>

            {/* Messages Area - Scrollable */}
            <div className="flex-1 overflow-hidden">
              <ScrollArea className="h-full p-4" ref={scrollAreaRef}>
                <Messages messages={showingMessages} isAssistantSpeaking={isAssistantSpeaking} isActive={isActive} />
              </ScrollArea>
            </div>
          </>
        )}

        {/* Voice Control Area */}
        <div className="p-4 border-t border-gray-200 bg-white">
          {/* System Prompt Configuration */}
          {!isLoading && !isActive && (
            <div className="mb-4 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">System Prompt:</label>
                <div className="space-y-2">
                  <Textarea
                    value={inputSystemPrompt}
                    onChange={(e) => setInputSystemPrompt(e.target.value)}
                    placeholder="Enter system prompt..."
                    className="min-h-10 resize-y"
                  />
                  <div className="flex space-x-2">
                    <Button
                      onClick={() => {
                        setInputSystemPrompt(defaultSystemPrompt);
                        setSystemPrompt(defaultSystemPrompt);
                      }}
                      variant="outline"
                      size="sm"
                    >
                      Reset
                    </Button>
                    <Button
                      onClick={() => {
                        setSystemPrompt(inputSystemPrompt);
                        localStorage.setItem('systemPrompt', inputSystemPrompt);
                      }}
                      disabled={inputSystemPrompt === systemPrompt}
                      size="sm"
                    >
                      Update
                    </Button>
                  </div>
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">Voice:</label>
                <Select value={voiceId} onValueChange={setVoiceId}>
                  <SelectTrigger className="w-auto min-w-48">
                    <SelectValue placeholder="Select voice" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tiffany">Tiffany (US English, Female)</SelectItem>
                    <SelectItem value="matthew">Matthew (US English, Male)</SelectItem>
                    <SelectItem value="amy">Amy (GB English, Female)</SelectItem>
                    <SelectItem value="ambre">Ambre (French, Female)</SelectItem>
                    <SelectItem value="florian">Florian (French, Male)</SelectItem>
                    <SelectItem value="beatrice">Beatrice (Italian, Female)</SelectItem>
                    <SelectItem value="lorenzo">Lorenzo (Italian, Male)</SelectItem>
                    <SelectItem value="greta">Greta (German, Female)</SelectItem>
                    <SelectItem value="lennart">Lennart (German, Male)</SelectItem>
                    <SelectItem value="lupe">Lupe (Spanish, Female)</SelectItem>
                    <SelectItem value="carlos">Carlos (Spanish, Male)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">MCP Config:</label>
                <div className="space-y-2">
                  <Textarea
                    value={inputMcpConfig}
                    onChange={(e) => handleMcpConfigChange(e.target.value)}
                    placeholder="Enter MCP configuration as JSON..."
                    className="min-h-32 resize-y font-mono text-sm"
                  />
                  {mcpConfigError && (
                    <div className="text-red-500 text-xs bg-red-50 p-2 rounded border">{mcpConfigError}</div>
                  )}
                  <div className="flex space-x-2">
                    <Button onClick={handleFormatMcpConfig} variant="outline" size="sm">
                      Format
                    </Button>
                    <Button
                      onClick={handleUpdateMcpConfig}
                      disabled={
                        !!mcpConfigError ||
                        inputMcpConfig === JSON.stringify(mcpConfig, null, 2) ||
                        (mcpConfig === EmptyMcpConfig && inputMcpConfig.trim() === '')
                      }
                      size="sm"
                    >
                      Update
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Voice Controls */}
          <div className="relative flex items-center mt-6">
            <div className="absolute inset-0 flex items-center justify-center">
              {!isActive ? (
                <Button onClick={handleStartSession} disabled={isLoading} className="w-full max-w-xs h-12" size="lg">
                  {!isLoading ? (
                    <>
                      <Mic className="mr-2 h-5 w-5" />
                      Start Voice Chat
                    </>
                  ) : (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                  )}
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    onClick={toggleMute}
                    disabled={isLoading}
                    variant={isMuted ? 'secondary' : 'outline'}
                    size="lg"
                    className="h-12"
                  >
                    {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                  </Button>
                  <Button
                    onClick={handleCloseSession}
                    disabled={isLoading}
                    variant="destructive"
                    className="h-12"
                    size="lg"
                  >
                    {!isLoading ? (
                      <>
                        <StopCircle className="mr-2 h-5 w-5" />
                        Stop Voice Chat
                      </>
                    ) : (
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                    )}
                  </Button>
                </div>
              )}
            </div>
            <div className="ml-auto relative z-10">
              <Link href="/api/auth/sign-out" className="cursor-default flex items-center" prefetch={false}>
                <LogOut className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">Sign Out</span>
              </Link>
            </div>
          </div>
        </div>

        {/* Completion Modal */}
        <Dialog open={completionModalOpen} onOpenChange={setCompletionModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-center text-xl">
                {endReason ? '⚠️ Error Occurred' : '🎉 Conversation Completed!'}
              </DialogTitle>
            </DialogHeader>
            <div className="flex flex-col items-center space-y-4 py-4">
              {endReason ? (
                <>
                  <div className="text-6xl">⚠️</div>
                  <p className="text-center text-gray-600">
                    An error occurred and the session ended
                    <br />
                    <span className="text-sm font-mono bg-gray-100 px-2 py-1 rounded mt-2 inline-block">
                      {endReason}
                    </span>
                  </p>
                </>
              ) : (
                <>
                  <div className="text-6xl">🎉</div>
                  <p className="text-center text-gray-600">
                    Great job!
                    <br />
                    You can review your conversation history later.
                  </p>
                </>
              )}
              <Button onClick={() => setCompletionModalOpen(false)} className="w-full">
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
