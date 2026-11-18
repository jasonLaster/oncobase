/** The WebRTC side of a Talk call: the mic goes up, the voice comes back, and
 * Realtime events travel on a data channel. No keys or prompts live here. */
export type TalkEvent = { type: string; [key: string]: unknown };
export type TalkFailure = "unsupported" | "mic-denied" | "no-mic" | "busy" | "unavailable" | "network";
export class TalkStartError extends Error {
  constructor(readonly failure: TalkFailure) { super(failure); }
}

export type TalkTransport = {
  send: (event: TalkEvent) => void;
  setMuted: (muted: boolean) => void;
  close: () => void;
  microphone: MediaStream;
  /** Resolves when the remote voice stream arrives. */
  voice: Promise<MediaStream>;
};

export async function connectTalk({ apiUrl, onEvent, onDropped }: {
  apiUrl: string;
  onEvent: (event: TalkEvent) => void;
  onDropped: () => void;
}): Promise<TalkTransport> {
  if (typeof RTCPeerConnection === "undefined" || !navigator.mediaDevices?.getUserMedia) throw new TalkStartError("unsupported");
  let microphone: MediaStream;
  try {
    microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    throw new TalkStartError(name === "NotFoundError" || name === "OverconstrainedError" ? "no-mic" : "mic-denied");
  }

  const connection = new RTCPeerConnection();
  const audio = new Audio();
  audio.autoplay = true;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    channel.close();
    connection.close();
    microphone.getTracks().forEach(track => track.stop());
    audio.pause();
    audio.srcObject = null;
  };

  let resolveVoice!: (stream: MediaStream) => void;
  const voice = new Promise<MediaStream>(resolve => { resolveVoice = resolve; });
  connection.ontrack = event => {
    const stream = event.streams[0] ?? new MediaStream([event.track]);
    audio.srcObject = stream;
    void audio.play().catch(() => {});
    resolveVoice(stream);
  };
  microphone.getTracks().forEach(track => connection.addTrack(track, microphone));

  const channel = connection.createDataChannel("oai-events");
  channel.onmessage = message => {
    try { onEvent(JSON.parse(String(message.data)) as TalkEvent); } catch { /* Ignore frames that are not JSON. */ }
  };
  const dropped = () => { if (!closed) { close(); onDropped(); } };
  connection.onconnectionstatechange = () => {
    // "disconnected" can recover by itself. "failed" cannot.
    if (connection.connectionState === "failed") dropped();
  };

  try {
    const opened = new Promise<void>((resolve, reject) => {
      channel.onopen = () => resolve();
      setTimeout(() => reject(new TalkStartError("network")), 20_000);
    });
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    let response: Response;
    try {
      response = await fetch(apiUrl, { method: "POST", headers: { "Content-Type": "application/sdp" }, body: offer.sdp });
    } catch { throw new TalkStartError("network"); }
    if (!response.ok) throw new TalkStartError(response.status === 429 ? "busy" : response.status === 503 ? "unavailable" : "network");
    await connection.setRemoteDescription({ type: "answer", sdp: await response.text() });
    await opened;
  } catch (error) {
    close();
    throw error instanceof TalkStartError ? error : new TalkStartError("network");
  }
  channel.onclose = dropped;

  return {
    send: event => { if (channel.readyState === "open") channel.send(JSON.stringify(event)); },
    setMuted: muted => microphone.getAudioTracks().forEach(track => { track.enabled = !muted; }),
    close, microphone, voice,
  };
}
