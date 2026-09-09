import 'package:camera_ai_mobile/features/events/domain/camera_event.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('parses an event returned by the existing API', () {
    final event = CameraEvent.fromJson({
      'id': 42,
      'camera': 'front-door',
      'timestamp': '2026-09-09T01:02:03.000Z',
      'type': 'person',
      'acknowledged': 1,
      'person_id': 'person-1',
      'person_label': 'An',
      'image_key': 'images/42.jpg',
      'video_key': 'videos/42.mp4',
    });

    expect(event.id, 42);
    expect(event.camera, 'front-door');
    expect(event.acknowledged, isTrue);
    expect(event.personLabel, 'An');
    expect(event.hasImage, isTrue);
    expect(event.hasVideo, isTrue);
  });

  test('rejects an event without required identity fields', () {
    expect(
      () => CameraEvent.fromJson({'type': 'motion'}),
      throwsFormatException,
    );
  });
}
