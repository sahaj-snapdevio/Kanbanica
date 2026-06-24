"use client";

import { MicrophoneIcon, StopIcon } from "@phosphor-icons/react";
import * as React from "react";
import { cn } from "@/lib/utils";

interface VoiceInputButtonProps {
  disabled?: boolean;
  onTranscript: (text: string) => void;
}

export function VoiceInputButton({
  onTranscript,
  disabled,
}: VoiceInputButtonProps) {
  const [listening, setListening] = React.useState(false);
  const [supported, setSupported] = React.useState(true);
  const recognitionRef = React.useRef<any>(null);

  React.useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      let finalTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript) {
        onTranscript(finalTranscript);
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      if (event.error !== "no-speech") {
        setListening(false);
      }
    };

    recognition.onend = () => {
      // If still listening, restart (continuous mode)
      if (recognitionRef.current?._shouldRestart) {
        try {
          recognition.start();
        } catch {}
      } else {
        setListening(false);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.stop();
      } catch {}
    };
  }, [onTranscript]);

  function toggleListening() {
    if (!recognitionRef.current) {
      return;
    }

    if (listening) {
      recognitionRef.current._shouldRestart = false;
      recognitionRef.current.stop();
      setListening(false);
    } else {
      try {
        recognitionRef.current._shouldRestart = true;
        recognitionRef.current.start();
        setListening(true);
      } catch (e) {
        console.error("Failed to start speech recognition:", e);
      }
    }
  }

  if (!supported) {
    return null;
  }

  return (
    <button
      className={cn(
        "relative flex size-8 items-center justify-center rounded-md transition-colors",
        listening
          ? "bg-red-500/10 text-red-500 hover:bg-red-500/20"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
        disabled && "opacity-50 cursor-not-allowed"
      )}
      disabled={disabled}
      onClick={toggleListening}
      title={listening ? "Stop voice input" : "Start voice input"}
      type="button"
    >
      {listening ? (
        <>
          <StopIcon className="size-4" weight="fill" />
          <span className="absolute -top-0.5 -right-0.5 flex size-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full size-2 bg-red-500" />
          </span>
        </>
      ) : (
        <MicrophoneIcon className="size-4" />
      )}
    </button>
  );
}
