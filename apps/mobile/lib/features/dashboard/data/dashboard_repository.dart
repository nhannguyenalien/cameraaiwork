import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../../cameras/domain/camera.dart';

final dashboardRepositoryProvider = Provider<DashboardRepository>(
  (ref) => DashboardRepository(ref.read(apiClientProvider)),
);

final dashboardProvider = FutureProvider<DashboardData>((ref) {
  return ref.read(dashboardRepositoryProvider).load();
});

class DashboardRepository {
  const DashboardRepository(this.client);
  final ApiClient client;

  Future<DashboardData> load() async {
    final responses = await Future.wait([
      client.request<Map<String, dynamic>>('/api/settings/account'),
      client.request<List<dynamic>>('/api/cameras'),
    ]);
    return DashboardData(
      account: (responses[0].data as Map).cast<String, dynamic>(),
      cameras: (responses[1].data as List)
          .whereType<Map>()
          .map((item) => CameraSummary.fromJson(item.cast<String, dynamic>()))
          .toList(growable: false),
    );
  }
}

class DashboardData {
  const DashboardData({required this.account, required this.cameras});
  final Map<String, dynamic> account;
  final List<CameraSummary> cameras;
}
