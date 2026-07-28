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

// biome-ignore lint/suspicious/noExplicitAny: proto-loader 동적 스텁
type GrpcStub = any;

export class EmulatorGrpc {
  private constructor(private readonly stub: GrpcStub) {}

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

  // 참고: streamScreenshot(RGBA raw 스트림)은 실측상 WS 대역폭 배압으로 역효과라
  // 폐기했다 (android-emulator.ts의 비디오 경로 주석 참조). 재도입 시 배압 재검증 필수.

  /** 터치 이벤트 — pressure>0 = down/move, 0 = up */
  sendTouch(x: number, y: number, pressure: number): void {
    this.stub.sendTouch(
      { touches: [{ x: Math.round(x), y: Math.round(y), pressure, identifier: 0 }] },
      () => undefined,
    );
  }

  close(): void {
    grpc.closeClient(this.stub);
  }
}
