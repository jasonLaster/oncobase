type Fake = {
  sent: Array<{ type: string; item?: { type: string; role?: string; call_id?: string; output?: string; content?: Array<{ text: string }> } }>;
  peers: number; closed: boolean; micCalls: number; micState: () => { enabled: boolean; readyState: string } | null;
  emit: (event: unknown) => void; drop: () => void;
};
declare global { interface Window { __talk: Fake; __micFailure?: string; __sameDocument?: boolean } }

/** Stands in for the browser's call to OpenAI. Everything above it runs for
 * real: the panel, conversation, tools, library search and client routing. */
export function installFakeRealtime() {
  let channel: { readyState: string; onopen?: () => void; onmessage?: (event: { data: string }) => void; onclose?: () => void } | undefined;
  let peer: { connectionState: string; onconnectionstatechange?: () => void } | undefined;
  let track: MediaStreamTrack | undefined;
  const fake: Fake = {
    sent: [], peers: 0, closed: false, micCalls: 0,
    micState: () => track ? { enabled: track.enabled, readyState: track.readyState } : null,
    emit: event => channel!.onmessage?.({ data: JSON.stringify(event) }),
    drop: () => { peer!.connectionState = "failed"; peer!.onconnectionstatechange?.(); },
  };
  window.__talk = fake;
  navigator.mediaDevices.getUserMedia = async () => {
    fake.micCalls++;
    if (window.__micFailure) throw new DOMException("Refused", window.__micFailure);
    const stream = new AudioContext().createMediaStreamDestination().stream;
    track = stream.getAudioTracks()[0];
    return stream;
  };
  window.RTCPeerConnection = class {
    connectionState = "new";
    onconnectionstatechange?: () => void;
    constructor() { fake.peers++; peer = this; fake.closed = false; }
    addTrack() {}
    createDataChannel() {
      const created = { readyState: "connecting", send: (data: string) => fake.sent.push(JSON.parse(data)), close() { created.readyState = "closed"; } };
      channel = created;
      return created;
    }
    async createOffer() { return { type: "offer", sdp: "v=0\r\nfake-offer\r\n" }; }
    async setLocalDescription() {}
    async setRemoteDescription() { setTimeout(() => { channel!.readyState = "open"; channel!.onopen?.(); }); }
    close() { fake.closed = true; }
  } as never;
}
