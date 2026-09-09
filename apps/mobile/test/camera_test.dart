import 'package:camera_ai_mobile/features/cameras/domain/camera.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('parses camera and uses fallback display names', () {
    final camera = CameraSummary.fromJson({
      'cameraId': 'cam-1',
      'stream': 'front-door',
      'siteId': 'site-1',
      'cameraName': null,
      'siteName': 'Văn phòng',
    });

    expect(camera.displayName, 'cam-1');
    expect(camera.siteDisplayName, 'Văn phòng');
  });

  test('parses live session expiry from unix seconds', () {
    final session = LiveSession.fromJson({
      'url': 'https://relay.example/live/token/stream.html',
      'expiresAt': 1800000000,
      'viewerLimit': 5,
    });

    expect(session.url.host, 'relay.example');
    expect(session.expiresAt.isUtc, isTrue);
    expect(session.viewerLimit, 5);
  });
}
