'use client';

import { useEffect, useId, useRef, useState } from 'react';

interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
}

export function InstallButton() {
  const installPrompt = useRef<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [prompting, setPrompting] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const instructionsId = useId();

  useEffect(() => {
    function capturePrompt(event: Event) {
      event.preventDefault();
      installPrompt.current = event as InstallPromptEvent;
    }

    function onInstalled() {
      installPrompt.current = null;
      setInstalled(true);
    }

    window.addEventListener('beforeinstallprompt', capturePrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', capturePrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function handleInstall() {
    const prompt = installPrompt.current;
    if (!prompt) {
      setShowInstructions(current => !current);
      return;
    }

    installPrompt.current = null;
    setPrompting(true);
    setShowInstructions(false);
    try {
      await prompt.prompt();
    } catch {
      setShowInstructions(true);
    } finally {
      setPrompting(false);
    }
  }

  if (installed) return null;

  return (
    <div className="space-y-2 [@media(display-mode:standalone)]:hidden">
      <button
        type="button"
        onClick={handleInstall}
        disabled={prompting}
        aria-expanded={showInstructions}
        aria-controls={instructionsId}
        className="min-h-11 rounded-full border border-[#153D2C]/30 bg-white px-4 text-sm font-semibold text-[#153D2C] transition hover:bg-[#EAF0EA] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#153D2C] disabled:opacity-60"
      >
        Cài BrewLite
      </button>
      <ul id={instructionsId} hidden={!showInstructions} className="max-w-lg space-y-1 rounded-xl border border-[#E8DFC8] bg-white px-4 py-3 text-sm text-[#3D2E24]">
        <li><strong>iPhone/iPad</strong> · Mở bằng Safari, chọn Chia sẻ → Thêm vào màn hình chính.</li>
        <li><strong>Android hoặc máy tính</strong> · Mở menu trình duyệt và chọn Cài đặt ứng dụng hoặc Thêm vào màn hình chính nếu có.</li>
      </ul>
    </div>
  );
}
