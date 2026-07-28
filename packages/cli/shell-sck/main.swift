// crosspane SCK 캡처 헬퍼 — iOS 시뮬레이터 "창"을 ScreenCaptureKit으로 30fps 캡처해
// JPEG 연속 스트림(FFD8…FFD9 이어붙임)을 stdout으로 내보낸다.
// 시뮬레이터 내부 API 없이(공개 API만) 60fps급 무결점 프레임을 얻는 유일한 경로.
// 요구: Simulator.app 창이 화면에 있어야 하고, 최초 1회 화면 기록 권한 승인 필요.
import CoreImage
import CoreMedia
import ScreenCaptureKit

let ciContext = CIContext()
let jpegQuality = 0.6

final class Output: NSObject, SCStreamOutput {
  func stream(
    _ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
    of type: SCStreamOutputType
  ) {
    guard type == .screen, let pixelBuffer = sampleBuffer.imageBuffer else { return }
    let image = CIImage(cvPixelBuffer: pixelBuffer)
    guard
      let data = ciContext.jpegRepresentation(
        of: image, colorSpace: CGColorSpaceCreateDeviceRGB(),
        options: [
          kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: jpegQuality
        ])
    else { return }
    FileHandle.standardOutput.write(data)
  }
}

let output = Output()
var streamRef: SCStream?

Task {
  do {
    let content = try await SCShareableContent.current
    guard
      let window = content.windows.first(where: {
        $0.owningApplication?.bundleIdentifier == "com.apple.iphonesimulator" && $0.isOnScreen
          && $0.frame.width > 100
      })
    else {
      FileHandle.standardError.write(Data("no-simulator-window\n".utf8))
      exit(2)
    }
    let filter = SCContentFilter(desktopIndependentWindow: window)
    let config = SCStreamConfiguration()
    // argv[1] = 기기 화면비(w/h) — 창의 타이틀바를 잘라 기기 화면만 캡처한다
    // (클릭 좌표는 기기 화면 기준 정규화라 타이틀바가 섞이면 어긋난다)
    let frameW = window.frame.width
    let frameH = window.frame.height
    var sourceY: CGFloat = 0
    var contentH = frameH
    if CommandLine.arguments.count > 1, let ratio = Double(CommandLine.arguments[1]), ratio > 0 {
      contentH = frameW / CGFloat(ratio)
      sourceY = max(0, frameH - contentH)
    }
    config.sourceRect = CGRect(x: 0, y: sourceY, width: frameW, height: contentH)
    // 창 크기 1x — pane 표시 크기에 충분하고 JPEG 인코딩이 가볍다
    config.width = Int(frameW)
    config.height = Int(contentH)
    config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
    config.showsCursor = false
    let stream = SCStream(filter: filter, configuration: config, delegate: nil)
    streamRef = stream
    try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: DispatchQueue(label: "cap"))
    try await stream.startCapture()
  } catch {
    FileHandle.standardError.write(Data("sck-error: \(error)\n".utf8))
    exit(3)
  }
}
RunLoop.main.run()
