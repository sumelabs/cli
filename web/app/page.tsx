"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const INSTALL_COMMAND = "curl https://cli.sume.com/install -fsS | bash";

export default function Home() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyInstallCommand = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
    } catch {
      const area = document.createElement("textarea");
      area.value = INSTALL_COMMAND;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    }

    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <main>
      <a href="https://docs.sume.com/cli/install-login" aria-label="Sume CLI docs">
        <svg
          viewBox="0 0 40 49"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className="logo"
        >
          <path
            d="M10.8198 48.8606H1.03593C0.460416 48.8606 0 48.3427 0 47.7671V10.4159C0 9.8404 0.460416 9.37999 1.03593 9.37999H10.9349C11.2802 9.37999 11.4528 9.09223 11.3953 8.74692C11.3953 8.45916 11.2802 8.1714 11.2802 7.88364C11.05 4.20031 13.6974 0.804747 17.3231 0.114124C21.9848 -0.691603 26.071 2.87662 26.071 7.42322C26.071 7.88364 26.071 8.34405 25.9559 8.74692C25.8984 9.03467 26.1286 9.37999 26.4163 9.37999H38.3871C38.9627 9.37999 39.4231 9.8404 39.4231 10.4159V19.8544C39.4231 19.8544 39.1929 20.3724 38.9051 20.3724H37.0059C32.9773 20.3724 29.4666 23.4802 29.2939 27.5089C29.1213 31.5375 32.4017 35.1057 36.4879 35.2208C36.5455 35.2208 36.603 35.2208 36.6606 35.2208C36.7181 35.2208 36.7757 35.2208 36.8332 35.2208H38.8476C38.8476 35.2208 39.3655 35.451 39.3655 35.7388V47.8822C39.3655 48.4578 38.9051 48.9182 38.3296 48.9182H26.1286C26.1286 48.9182 25.6106 48.688 25.6106 48.4002V46.2132C25.6106 42.4724 22.9057 39.0768 19.1648 38.6164C14.6182 38.0409 10.8198 41.5515 10.8198 45.983C10.8198 46.7887 10.9349 47.5369 11.1651 48.2851C11.2802 48.5729 11.05 48.9182 10.7047 48.9182L10.8198 48.8606Z"
            fill="currentColor"
          />
        </svg>
      </a>

      <section aria-labelledby="title">
        <h1 id="title">cli.sume.com</h1>
        <button
          type="button"
          className="install"
          onClick={copyInstallCommand}
          aria-live="polite"
          aria-label={
            copied
              ? "Install command copied"
              : "Copy the Sume CLI install command"
          }
        >
          {copied ? "copied to clipboard" : INSTALL_COMMAND}
        </button>
        <nav aria-label="CLI links">
          <a href="https://docs.sume.com/cli/install-login">docs</a>
          <a href="/install.ps1">powershell</a>
        </nav>
      </section>
    </main>
  );
}
