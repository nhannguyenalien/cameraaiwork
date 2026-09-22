import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../cameras/domain/camera.dart';
import '../domain/camera_event.dart';

final eventRepositoryProvider = Provider<EventRepository>(
  (ref) => EventRepository(ref.read(apiClientProvider)),
);

final eventImageProvider = FutureProvider.autoDispose.family<Uint8List, int>(
  (ref, id) => ref.read(eventRepositoryProvider).image(id),
);

final peopleProvider = FutureProvider<List<EventPerson>>(
  (ref) => ref.read(eventRepositoryProvider).people(),
);

final cameraEventsProvider = FutureProvider.autoDispose
    .family<List<CameraEvent>, String>((ref, cameraStream) async {
      final page = await ref
          .read(eventRepositoryProvider)
          .list(camera: cameraStream, limit: 8);
      return page.items;
    });

final cameraTimelineEventsProvider = FutureProvider.autoDispose
    .family<List<CameraEvent>, CameraTimelineQuery>((ref, query) async {
      final page = await ref
          .read(eventRepositoryProvider)
          .list(
            camera: query.cameraStream,
            from: query.dayStart,
            to: query.dayStart.add(const Duration(days: 1)),
            limit: 100,
          );
      return page.items;
    });

class CameraTimelineQuery {
  const CameraTimelineQuery({
    required this.cameraStream,
    required this.dayStart,
  });

  final String cameraStream;
  final DateTime dayStart;

  @override
  bool operator ==(Object other) =>
      other is CameraTimelineQuery &&
      other.cameraStream == cameraStream &&
      other.dayStart == dayStart;

  @override
  int get hashCode => Object.hash(cameraStream, dayStart);
}

class EventRepository {
  const EventRepository(this.client);
  final ApiClient client;

  Future<EventPage> list({
    String? cursor,
    String? camera,
    String? person,
    String? type,
    DateTime? from,
    DateTime? to,
    int limit = 20,
  }) async {
    final response = await client.request<List<dynamic>>(
      '/api/events',
      queryParameters: {
        'limit': limit,
        if (cursor?.isNotEmpty == true) 'cursor': cursor,
        if (camera?.isNotEmpty == true) 'camera': camera,
        if (person?.isNotEmpty == true) 'person': person,
        if (type?.isNotEmpty == true) 'type': type,
        if (from != null) 'from': from.toUtc().toIso8601String(),
        if (to != null) 'to': to.toUtc().toIso8601String(),
      },
    );
    final items = response.data!
        .whereType<Map>()
        .map((row) => CameraEvent.fromJson(row.cast<String, dynamic>()))
        .toList(growable: false);
    final next = response.headers.value('x-next-cursor');
    return EventPage(items: items, nextCursor: next);
  }

  Future<List<CameraSummary>> cameras() async {
    final response = await client.request<List<dynamic>>('/api/cameras');
    return response.data!
        .whereType<Map>()
        .map((row) => CameraSummary.fromJson(row.cast<String, dynamic>()))
        .toList(growable: false);
  }

  Future<List<EventPerson>> people() async {
    final response = await client.request<List<dynamic>>('/api/people');
    return response.data!
        .whereType<Map>()
        .map((row) => EventPerson.fromJson(row.cast<String, dynamic>()))
        .toList(growable: false);
  }

  Future<Uint8List> image(int id) async {
    final response = await client.request<List<int>>(
      '/api/events/$id/image',
      options: Options(responseType: ResponseType.bytes),
    );
    return Uint8List.fromList(response.data!);
  }

  Future<void> updateEvent(int id, {bool? acknowledged, String? note}) async {
    await client.request<Map<String, dynamic>>(
      '/api/events/$id',
      method: 'PATCH',
      data: {'acknowledged': ?acknowledged, 'note': ?note},
    );
  }

  Future<String?> renamePerson(String id, String label) async {
    final response = await client.request<Map<String, dynamic>>(
      '/api/people/${Uri.encodeComponent(id)}',
      method: 'PATCH',
      data: {'label': label},
    );
    return response.data?['label']?.toString();
  }

  Uri videoUri(int id) =>
      Uri.parse(client.dio.options.baseUrl).resolve('/api/events/$id/video');
}
