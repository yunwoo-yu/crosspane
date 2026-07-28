import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

/**
 * Android Emulator 공식 gRPC 컨트롤 — Android Studio "Running Devices"가 쓰는 그 API.
 * adb input(프로세스+JVM ~35ms/개)과 화면 인코더(screenrecord/scrcpy ~300ms 버퍼링)를
 * 모두 우회한다: sendTouch 왕복 ~수 ms, streamScreenshot은 렌더러 직결 프레임 스트림.
 * proto는 SDK emulator/lib에 동봉돼 있어 배포물에 포함할 필요가 없다.
 */

interface ImageMessage {
  image: Buffer;
}

// biome-ignore lint/suspicious/noExplicitAny: proto-loader 동적 스텁
type GrpcStub = any;

export class EmulatorGrpc {
  private constructor(
    private readonly stub: GrpcStub,
    private screenStream: grpc.ClientReadableStream<ImageMessage> | null = null,
  ) {}

  /** 에뮬레이터 gRPC에 연결 시도 — 짧은 데드라인으로 가용성 확인 후 실패 시 undefined */
  static async connect(sdkDir: string, port: number): Promise<EmulatorGrpc | undefined> {
    const protoDir = join(sdkDir, 'emulator', 'lib');
    const protoPath = join(protoDir, 'emulator_controller.proto');
    if (!existsSync(protoPath)) return undefined;
    try {
      const definition = protoLoader.loadSync(protoPath, {
        includeDirs: [protoDir],
        longs: Number,
        defaults: true,
      });
      const pkg = grpc.loadPackageDefinition(definition) as GrpcStub;
      const stub = new pkg.android.emulation.control.EmulatorController(
        `127.0.0.1:${port}`,
        grpc.credentials.createInsecure(),
      );
      await new Promise<void>((resolve, reject) => {
        const deadline = new Date(Date.now() + 3_000);
        stub.waitForReady(deadline, (err: Error | undefined) => (err ? reject(err) : resolve()));
      });
      return new EmulatorGrpc(stub);
    } catch {
      return undefined;
    }
  }

  /** 렌더러 직결 화면 스트림 — RGBA raw(인코딩 제로), 화면이 변할 때만 프레임이 온다 */
  startScreenStream(
    width: number,
    height: number,
    onFrame: (rgba: Buffer, width: number, height: number) => void,
  ): void {
    this.stopScreenStream();
    const stream = this.stub.streamScreenshot({
      format: 'RGBA8888',
      width,
      height,
    }) as grpc.ClientReadableStream<ImageMessage & { format?: { width: number; height: number } }>;
    this.screenStream = stream;
    stream.on('data', (message) => {
      if (message.image?.length > 0) {
        onFrame(
          Buffer.from(message.image),
          message.format?.width ?? width,
          message.format?.height ?? height,
        );
      }
    });
    stream.on('error', () => undefined); // cancel 포함 — 재시작은 세션이 관리
  }

  stopScreenStream(): void {
    this.screenStream?.cancel();
    this.screenStream = null;
  }

  /** 터치 이벤트 — pressure>0 = down/move, 0 = up */
  sendTouch(x: number, y: number, pressure: number): void {
    this.stub.sendTouch(
      { touches: [{ x: Math.round(x), y: Math.round(y), pressure, identifier: 0 }] },
      () => undefined,
    );
  }

  close(): void {
    this.stopScreenStream();
    grpc.closeClient(this.stub);
  }
}
