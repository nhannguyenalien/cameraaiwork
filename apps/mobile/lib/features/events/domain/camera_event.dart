// Postgres BIGINT/COUNT columns (events.id, preview_event_id, seen_count)
// are serialized as JSON strings, not numbers, to avoid precision loss —
// accept either representation instead of assuming a JSON number.
int? _parseInt(Object? value) => switch (value) {
  final num v => v.toInt(),
  final String v => int.tryParse(v),
  _ => null,
};

class CameraEvent {
  const CameraEvent({
    required this.id,
    required this.camera,
    required this.timestamp,
    required this.type,
    required this.acknowledged,
    this.siteId,
    this.personId,
    this.personLabel,
    this.imageKey,
    this.videoKey,
    this.note,
  });

  final int id;
  final String camera;
  final DateTime timestamp;
  final String type;
  final bool acknowledged;
  final String? siteId;
  final String? personId;
  final String? personLabel;
  final String? imageKey;
  final String? videoKey;
  final String? note;

  bool get hasImage => imageKey?.isNotEmpty == true;
  bool get hasVideo => videoKey?.isNotEmpty == true;

  factory CameraEvent.fromJson(Map<String, dynamic> json) {
    final id = _parseInt(json['id']);
    final camera = json['camera']?.toString();
    final timestamp = DateTime.tryParse(json['timestamp']?.toString() ?? '');
    if (id == null || camera == null || timestamp == null) {
      throw const FormatException('Dữ liệu sự kiện không hợp lệ');
    }
    return CameraEvent(
      id: id,
      camera: camera,
      timestamp: timestamp,
      type: json['type']?.toString() ?? 'unknown',
      acknowledged: json['acknowledged'] == true || json['acknowledged'] == 1,
      siteId: json['site_id']?.toString(),
      personId: json['person_id']?.toString(),
      personLabel: json['person_label']?.toString(),
      imageKey: json['image_key']?.toString(),
      videoKey: json['video_key']?.toString(),
      note: json['note']?.toString(),
    );
  }
}

extension CameraEventLabels on CameraEvent {
  String get typeLabel => switch (type) {
    'motion' => 'Chuyển động',
    'person' => 'Phát hiện người',
    _ => type,
  };
}

String eventDateLabel(DateTime value) {
  final date = value.toLocal();
  String two(int number) => number.toString().padLeft(2, '0');
  return '${two(date.hour)}:${two(date.minute)} · ${two(date.day)}/${two(date.month)}/${date.year}';
}

class EventPage {
  const EventPage({required this.items, this.nextCursor});
  final List<CameraEvent> items;
  final String? nextCursor;
  bool get hasMore => nextCursor?.isNotEmpty == true;
}

class EventPerson {
  const EventPerson({
    required this.id,
    this.label,
    this.firstSeenAt,
    this.lastSeenAt,
    this.seenCount = 0,
    this.previewEventId,
  });
  final String id;
  final String? label;
  final DateTime? firstSeenAt;
  final DateTime? lastSeenAt;
  final int seenCount;
  final int? previewEventId;
  String get displayName =>
      label?.trim().isNotEmpty == true ? label! : 'Người lạ #$id';

  factory EventPerson.fromJson(Map<String, dynamic> json) {
    final id = json['id']?.toString();
    if (id == null) throw const FormatException('Dữ liệu người không hợp lệ');
    return EventPerson(
      id: id,
      label: json['label']?.toString(),
      firstSeenAt: DateTime.tryParse(json['first_seen_at']?.toString() ?? ''),
      lastSeenAt: DateTime.tryParse(json['last_seen_at']?.toString() ?? ''),
      seenCount: _parseInt(json['seen_count']) ?? 0,
      previewEventId: _parseInt(json['preview_event_id']),
    );
  }
}
