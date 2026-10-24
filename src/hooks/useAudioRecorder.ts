import { useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [transcript, setTranscript] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        stream.getTracks().forEach((t) => t.stop());
        // Use browser SpeechRecognition or fall back
        await transcribeAudio(blob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch {
      toast.error('Could not access microphone. Please allow microphone access.');
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, [isRecording]);

  const transcribeAudio = async (blob: Blob) => {
    setIsTranscribing(true);
    try {
      // Use Web Speech API for transcription
      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        // The Web Speech API works on live audio, not blobs.
        // For blob transcription we play it back through an audio context.
        // Simpler approach: we'll use the recognition during recording instead.
      }
      // For now, play the audio and let the user review
      // The actual transcription happens via the browser's live recognition
      setIsTranscribing(false);
    } catch {
      setIsTranscribing(false);
    }
  };

  return {
    isRecording,
    audioBlob,
    transcript,
    setTranscript,
    isTranscribing,
    startRecording,
    stopRecording,
  };
}

// Live speech recognition hook that transcribes while recording
export function useSpeechRecognition() {
  const [transcript, setTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const startListening = useCallback(async () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error('Speech recognition is not supported in this browser. On iPhone, use Safari (iOS 14.5+) or type instead.');
      return;
    }

    // iOS Safari requires mic permission BEFORE SpeechRecognition will work.
    // getUserMedia triggers the permission prompt; SpeechRecognition by itself does not.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop the stream immediately — we just needed the permission grant.
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      toast.error('Microphone access denied. Enable it in your browser settings and try again.');
      return;
    }

    const recognition = new SpeechRecognition();
    // iOS Safari is unreliable with continuous mode — keep it off on iOS.
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    recognition.continuous = !isIOS;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = '';

    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += t + ' ';
        } else {
          interim += t;
        }
      }
      setTranscript(finalTranscript + interim);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        toast.error('Microphone blocked. Allow it in your browser settings.');
        setIsListening(false);
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        toast.error('Speech recognition error. Try again.');
      }
    };

    recognition.onend = () => {
      // On iOS, auto-restart while user still wants to listen (continuous=false ends quickly).
      if (isIOS && recognitionRef.current === recognition && (recognition as any)._userWantsListening) {
        try {
          recognition.start();
          return;
        } catch {
          // fall through to stop
        }
      }
      setIsListening(false);
    };

    (recognition as any)._userWantsListening = true;
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsListening(true);
    } catch (e) {
      console.error('Failed to start recognition:', e);
      toast.error('Could not start the microphone. Try again.');
    }
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      (recognitionRef.current as any)._userWantsListening = false;
      try { recognitionRef.current.stop(); } catch { /* noop */ }
      setIsListening(false);
    }
  }, []);

  const resetTranscript = useCallback(() => {
    setTranscript('');
  }, []);

  return {
    transcript,
    setTranscript,
    isListening,
    startListening,
    stopListening,
    resetTranscript,
  };
}
