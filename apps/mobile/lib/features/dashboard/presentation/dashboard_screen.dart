import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../auth/application/session_controller.dart';
import '../../cameras/domain/camera.dart';
import '../data/dashboard_repository.dart';

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(dashboardProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('CameraAI'),
        actions: [
          IconButton(
            tooltip: 'Mọi người',
            onPressed: () => context.push('/people'),
            icon: const Icon(Icons.people_outline),
          ),
          IconButton(
            tooltip: 'Sự kiện',
            onPressed: () => context.push('/events'),
            icon: const Icon(Icons.notifications_outlined),
          ),
          IconButton(
            tooltip: 'Đăng xuất',
            onPressed: () =>
                ref.read(sessionControllerProvider.notifier).logout(),
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(dashboardProvider.future),
        child: data.when(
          loading: () => ListView(
            children: const [
              SizedBox(height: 280),
              Center(child: CircularProgressIndicator()),
            ],
          ),
          error: (error, _) => ListView(
            padding: const EdgeInsets.all(24),
            children: [
              const Icon(Icons.cloud_off, size: 48),
              const SizedBox(height: 12),
              Text(error.toString(), textAlign: TextAlign.center),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: () => ref.invalidate(dashboardProvider),
                child: const Text('Thử lại'),
              ),
            ],
          ),
          data: (dashboard) => ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _AccountCard(account: dashboard.account),
              const SizedBox(height: 20),
              Text('Camera', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 8),
              if (dashboard.cameras.isEmpty)
                const Card(
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: Text('Chưa có camera nào.'),
                  ),
                )
              else
                ...dashboard.cameras.map(
                  (camera) => _CameraCard(camera: camera),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AccountCard extends StatelessWidget {
  const _AccountCard({required this.account});
  final Map<String, dynamic> account;

  @override
  Widget build(BuildContext context) {
    final plan = account['plan']?.toString().toUpperCase() ?? 'FREE';
    final usage = account['usage'] is Map ? account['usage'] as Map : const {};
    return Card(
      child: ListTile(
        leading: const CircleAvatar(child: Icon(Icons.shield_outlined)),
        title: Text('Gói $plan'),
        subtitle: Text(
          '${usage['sites'] ?? 0} site · ${usage['cameras'] ?? 0} camera',
        ),
      ),
    );
  }
}

class _CameraCard extends StatelessWidget {
  const _CameraCard({required this.camera});
  final CameraSummary camera;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        onTap: () => context.push('/camera', extra: camera),
        leading: const CircleAvatar(child: Icon(Icons.videocam_outlined)),
        title: Text(camera.displayName),
        subtitle: Text(camera.siteDisplayName),
        trailing: const Icon(Icons.chevron_right),
      ),
    );
  }
}
