// Vídeo/áudio ao vivo entre os jogadores: malha WebRTC (até 3 conexões por pessoa), sinalização pelo servidor da sala.
export interface RtcOpts {
  myId: string;
  iceServers: RTCIceServer[];
  send(to: string, data: unknown): void;
  onStream(id: string, stream: MediaStream | null): void;
}

interface Peer {
  pc: RTCPeerConnection;
  polite: boolean;
  making: boolean;
  ignore: boolean;
  audio: RTCRtpSender;
  video: RTCRtpSender;
  stream: MediaStream;
}

interface Signal {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export class RtcMesh {
  private peers = new Map<string, Peer>();
  private camTrack: MediaStreamTrack | null = null;
  private micTrack: MediaStreamTrack | null = null;
  localVideo = new MediaStream();

  constructor(private o: RtcOpts) {}

  get camOn(): boolean {
    return !!this.camTrack;
  }
  get micOn(): boolean {
    return !!this.micTrack;
  }

  setPeers(ids: readonly string[]): void {
    const want = new Set(ids.filter((i) => i !== this.o.myId));
    for (const id of want) if (!this.peers.has(id)) this.create(id);
    for (const id of [...this.peers.keys()]) if (!want.has(id)) this.drop(id);
  }

  private create(id: string): void {
    const pc = new RTCPeerConnection({ iceServers: this.o.iceServers });
    const a = pc.addTransceiver('audio', { direction: 'sendrecv' });
    const v = pc.addTransceiver('video', { direction: 'sendrecv' });
    const peer: Peer = { pc, polite: this.o.myId < id, making: false, ignore: false, audio: a.sender, video: v.sender, stream: new MediaStream() };
    this.peers.set(id, peer);
    if (this.micTrack) void a.sender.replaceTrack(this.micTrack);
    if (this.camTrack) void this.attachVideo(v.sender, this.camTrack);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.o.send(id, { candidate: e.candidate.toJSON() });
    };
    pc.onnegotiationneeded = async () => {
      try {
        peer.making = true;
        await pc.setLocalDescription();
        this.o.send(id, { description: pc.localDescription });
      } catch {
        /* renegocia depois */
      } finally {
        peer.making = false;
      }
    };
    pc.ontrack = (e) => {
      if (!peer.stream.getTracks().includes(e.track)) peer.stream.addTrack(e.track);
      this.o.onStream(id, peer.stream);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce();
    };
  }

  private drop(id: string): void {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.close();
    this.peers.delete(id);
    this.o.onStream(id, null);
  }

  async handle(from: string, data: Signal): Promise<void> {
    const peer = this.peers.get(from);
    if (!peer) return;
    const pc = peer.pc;
    try {
      if (data.description) {
        const d = data.description;
        const collision = d.type === 'offer' && (peer.making || pc.signalingState !== 'stable');
        peer.ignore = !peer.polite && collision;
        if (peer.ignore) return;
        await pc.setRemoteDescription(d);
        if (d.type === 'offer') {
          await pc.setLocalDescription();
          this.o.send(from, { description: pc.localDescription });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (e) {
          if (!peer.ignore) throw e;
        }
      }
    } catch {
      /* sinal fora de ordem: a próxima negociação corrige */
    }
  }

  private async attachVideo(sender: RTCRtpSender, track: MediaStreamTrack | null): Promise<void> {
    try {
      await sender.replaceTrack(track);
      if (!track) return;
      const p = sender.getParameters();
      if (!p.encodings || p.encodings.length === 0) p.encodings = [{}];
      p.encodings[0]!.maxBitrate = 280_000;
      await sender.setParameters(p);
    } catch {
      /* navegador sem setParameters */
    }
  }

  /** Liga/desliga a câmera. Desligar para o hardware (luz apaga). Lança erro se a permissão for negada. */
  async setCam(on: boolean): Promise<void> {
    if (on === this.camOn) return;
    if (on) {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15, max: 20 }, facingMode: 'user' } });
      this.camTrack = s.getVideoTracks()[0]!;
      this.localVideo = new MediaStream([this.camTrack]);
      for (const p of this.peers.values()) await this.attachVideo(p.video, this.camTrack);
    } else {
      this.camTrack?.stop();
      this.camTrack = null;
      this.localVideo = new MediaStream();
      for (const p of this.peers.values()) await this.attachVideo(p.video, null);
    }
  }

  async setMic(on: boolean): Promise<void> {
    if (on === this.micOn) return;
    if (on) {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.micTrack = s.getAudioTracks()[0]!;
      for (const p of this.peers.values()) await p.audio.replaceTrack(this.micTrack).catch(() => {});
    } else {
      this.micTrack?.stop();
      this.micTrack = null;
      for (const p of this.peers.values()) await p.audio.replaceTrack(null).catch(() => {});
    }
  }

  close(): void {
    this.camTrack?.stop();
    this.micTrack?.stop();
    this.camTrack = this.micTrack = null;
    for (const id of [...this.peers.keys()]) this.drop(id);
  }
}
