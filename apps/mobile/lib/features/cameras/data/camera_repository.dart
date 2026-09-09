import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../domain/camera.dart';

final cameraRepositoryProvider = Provider<CameraRepository>(
  (ref) => CameraRepository(ref.read(apiClientProvider)),
);

final cameraStatusProvider = FutureProvider.autoDispose
    .family<CameraStatus, CameraSummary>((ref, camera) {
      return ref.read(cameraRepositoryProvider).status(camera);
    });

final cameraSnapshotProvider = FutureProvider.autoDispose
    .family<Uint8List, CameraSummary>((ref, camera) {
      return ref.read(cameraRepositoryProvider).snapshot(camera);
    });

class CameraRepository {
  const CameraRepository(this.client);

  final ApiClient client;

  String _path(CameraSummary camera, String action) {
    final site = Uri.encodeComponent(camera.siteId);
    final cameraId = Uri.encodeComponent(camera.cameraId);
    return '/api/cameras/$site/$cameraId/$action';
  }

  Future<CameraStatus> status(CameraSummary camera) async {
    final response = await client.request<Map<String, dynamic>>(
      _path(camera, 'status'),
    );
    return CameraStatus.fromJson(response.data!);
  }

  Future<Uint8List> snapshot(CameraSummary camera) async {
    final response = await client.request<List<int>>(
      _path(camera, 'snapshot'),
      options: Options(responseType: ResponseType.bytes),
    );
    return Uint8List.fromList(response.data!);
  }

  Future<LiveSession> createLiveSession(CameraSummary camera) async {
    final response = await client.request<Map<String, dynamic>>(
      _path(camera, 'live'),
      method: 'POST',
    );
    return LiveSession.fromJson(response.data!);
  }

  Future<void> move(
    CameraSummary camera,
    String action, {
    int durationMs = 400,
  }) async {
    await client.request<Map<String, dynamic>>(
      _path(camera, 'ptz'),
      method: 'POST',
      data: {
        'action': action,
        if (action != 'home') 'speed': 0.5,
        if (action != 'home') 'durationMs': durationMs,
      },
    );
  }
}
