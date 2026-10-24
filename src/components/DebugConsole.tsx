import { useEffect, useState } from "react";

type LogEntry = {
  type: string;
  timestamp: string;
  message: string;
};

let logs: LogEntry[] = [];

export default function DebugConsole() {
  const [open, setOpen] = useState(false);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    const addLog = (type: string, args: any[]) => {
      const message = args
        .map((a) =>
          typeof a === "object"
            ? JSON.stringify(a, null, 2)
            : String(a)
        )
        .join(" ");

      logs.unshift({
        type,
        message,
        timestamp: new Date().toLocaleTimeString(),
      });

      if (logs.length > 1000) {
        logs = logs.slice(0, 1000);
      }

      forceUpdate((v) => v + 1);
    };

    console.log = (...args) => {
      addLog("LOG", args);
      originalLog(...args);
    };

    console.warn = (...args) => {
      addLog("WARN", args);
      originalWarn(...args);
    };

    console.error = (...args) => {
      addLog("ERROR", args);
      originalError(...args);
    };

    window.onerror = (msg, src, line, col, err) => {
      addLog("CRASH", [
        msg,
        src,
        line,
        col,
        err?.stack,
      ]);
    };

    window.onunhandledrejection = (event) => {
      addLog("PROMISE", [event.reason]);
    };

    return () => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    };
  }, []);

  const copyLogs = async () => {
    const text = logs
      .map(
        (log) =>
          `[${log.timestamp}] [${log.type}] ${log.message}`
      )
      .join("\n");

    await navigator.clipboard.writeText(text);
  };

  const getColor = (type: string) => {
    switch (type) {
      case "ERROR":
      case "CRASH":
        return "#ff6b6b";
      case "WARN":
        return "#ffd43b";
      case "PROMISE":
        return "#74c0fc";
      default:
        return "#69db7c";
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          width: 56,
          height: 56,
          borderRadius: "50%",
          border: "none",
          fontSize: 24,
          zIndex: 999999,
          boxShadow: "0 4px 12px rgba(0,0,0,.25)",
        }}
      >
        🐞
      </button>

      {logs.length > 0 && (
        <div
          style={{
            position: "fixed",
            bottom: 15,
            right: 15,
            minWidth: 22,
            height: 22,
            borderRadius: 999,
            background: "red",
            color: "white",
            fontSize: 11,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000000,
            padding: "0 6px",
          }}
        >
          {logs.length}
        </div>
      )}

      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "#111",
            zIndex: 9999999,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: 16,
              borderBottom: "1px solid #333",
            }}
          >
            <h3
              style={{
                color: "white",
                margin: 0,
              }}
            >
              Debug Console
            </h3>

            <div
              style={{
                display: "flex",
                gap: 8,
              }}
            >
              <button
                onClick={copyLogs}
                style={{
                  padding: "8px 12px",
                }}
              >
                📋 Copy
              </button>

              <button
                onClick={() => {
                  logs = [];
                  forceUpdate((v) => v + 1);
                }}
                style={{
                  padding: "8px 12px",
                }}
              >
                🗑 Clear
              </button>

              <button
                onClick={() => setOpen(false)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  border: "none",
                  fontSize: 18,
                }}
              >
                ✕
              </button>
            </div>
          </div>

          <div
            style={{
              flex: 1,
              overflow: "auto",
              padding: 12,
            }}
          >
            {logs.map((log, i) => (
              <div
                key={i}
                style={{
                  marginBottom: 12,
                  padding: 10,
                  borderRadius: 8,
                  background: "#1b1b1b",
                  borderLeft: `4px solid ${getColor(
                    log.type
                  )}`,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "#999",
                    marginBottom: 4,
                  }}
                >
                  {log.timestamp}
                </div>

                <div
                  style={{
                    color: getColor(log.type),
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                >
                  {log.type}
                </div>

                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    margin: 0,
                    color: "#fff",
                    fontSize: 12,
                    fontFamily:
                      "SFMono-Regular, Menlo, monospace",
                  }}
                >
                  {log.message}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}