import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../data/camera_repository.dart';
import '../domain/camera.dart';

class CameraDetailScreen extends ConsumerStatefulWidget {
  const CameraDetailScreen({required this.camera, super.key});

  final CameraSummary camera;

  @override
  ConsumerState<CameraDetailScreen> createState() => _CameraDetailScreenState();
}

class _CameraDetailScreenState extends ConsumerState<CameraDetailScreen> {
  WebViewController? _liveController;
  LiveSession? _liveSession;
  bool _startingLive = false;
  String? _actionError;

  Future<void> _startLive() async {
    setState(() {
      _startingLive = true;
      _actionError = null;
    });
    try {
      final session = await ref
          .read(cameraRepositoryProvider)
          .createLiveSession(widget.camera);
      final controller = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..setBackgroundColor(Colors.black)
        ..loadRequest(session.url);
      if (!mounted) return;
      setState(() {
        _liveSession = session;
        _liveController = controller;
      });
    } catch (error) {
      if (mounted) setState(() => _actionError = error.toString());
    } finally {
      if (mounted) setState(() => _startingLive = false);
    }
  }

  Future<void> _move(String action) async {
    setState(() => _actionError = null);
    try {
      await ref.read(cameraRepositoryProvider).move(widget.camera, action);
    } catch (error) {
      if (mounted) setState(() => _actionError = error.toString());
    }
  }

  void _refresh() {
    ref.invalidate(cameraStatusProvider(widget.camera));
    ref.invalidate(cameraSnapshotProvider(widget.camera));
  }

  @override
  Widget build(BuildContext context) {
    final status = ref.watch(cameraStatusProvider(widget.camera));
    final snapshot = ref.watch(cameraSnapshotProvider(widget.camera));
    final liveController = _liveController;
    final supportsPtz = status.asData?.value.supportsPtz == true;

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.camera.displayName),
        actions: [
          IconButton(
            onPressed: _refresh,
            tooltip: 'Làm mới',
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          AspectRatio(
            aspectRatio: 16 / 9,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: ColoredBox(
                color: Colors.black,
                child: liveController != null
                    ? WebViewWidget(controller: liveController)
                    : snapshot.when(
                        data: (bytes) =>
                            Image.memory(bytes, fit: BoxFit.contain),
                        loading: () =>
                            const Center(child: CircularProgressIndicator()),
                        error: (error, _) => _MediaError(
                          message: error.toString(),
                          onRetry: _refresh,
                        ),
                      ),
              ),
            ),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: _startingLive ? null : _startLive,
            icon: _startingLive
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.play_circle_outline),
            label: Text(
              liveController == null ? 'Xem trực tiếp' : 'Tạo lại phiên live',
            ),
          ),
          if (_liveSession case final session?)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                'Tối đa ${session.viewerLimit} người xem · phiên hết hạn ${_formatTime(session.expiresAt.toLocal())}',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          const SizedBox(height: 16),
          status.when(
            loading: () => const Card(
              child: ListTile(
                leading: CircularProgressIndicator(),
                title: Text('Đang kiểm tra trạng thái'),
              ),
            ),
            error: (error, _) => Card(
              child: ListTile(
                leading: const Icon(Icons.cloud_off, color: Colors.red),
                title: const Text('Không lấy được trạng thái'),
                subtitle: Text(error.toString()),
              ),
            ),
            data: (value) => _StatusCard(status: value),
          ),
          const SizedBox(height: 16),
          Text(
            'Điều khiển PTZ',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          _PtzControls(enabled: supportsPtz, onMove: _move),
          if (!supportsPtz)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                status.isLoading
                    ? 'Đang kiểm tra khả năng PTZ…'
                    : 'Camera không hỗ trợ PTZ hoặc đang offline.',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          if (_actionError case final error?)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                error,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
                textAlign: TextAlign.center,
              ),
            ),
        ],
      ),
    );
  }

  String _formatTime(DateTime time) {
    return '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}';
  }
}

class _MediaError extends StatelessWidget {
  const _MediaError({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.videocam_off, color: Colors.white70),
            const SizedBox(height: 8),
            Text(
              message,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white70),
            ),
            TextButton(onPressed: onRetry, child: const Text('Thử lại')),
          ],
        ),
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.status});
  final CameraStatus status;

  @override
  Widget build(BuildContext context) {
    final online = status.cameraOnline;
    return Card(
      child: ListTile(
        leading: Icon(
          online ? Icons.check_circle : Icons.error_outline,
          color: online ? Colors.green : Colors.orange,
        ),
        title: Text(online ? 'Camera online' : 'Camera offline'),
        subtitle: Text(
          '${status.message}${status.latencyMs == null ? '' : ' · ${status.latencyMs} ms'}',
        ),
      ),
    );
  }
}

class _PtzControls extends StatelessWidget {
  const _PtzControls({required this.enabled, required this.onMove});
  final bool enabled;
  final ValueChanged<String> onMove;

  @override
  Widget build(BuildContext context) {
    Widget button(IconData icon, String action, String tooltip) =>
        IconButton.filledTonal(
          onPressed: enabled ? () => onMove(action) : null,
          tooltip: tooltip,
          icon: Icon(icon),
        );

    return Column(
      children: [
        button(Icons.keyboard_arrow_up, 'up', 'Lên'),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            button(Icons.keyboard_arrow_left, 'left', 'Trái'),
            const SizedBox(width: 12),
            button(Icons.home_outlined, 'home', 'Vị trí gốc'),
            const SizedBox(width: 12),
            button(Icons.keyboard_arrow_right, 'right', 'Phải'),
          ],
        ),
        button(Icons.keyboard_arrow_down, 'down', 'Xuống'),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            button(Icons.zoom_out, 'zoomOut', 'Thu nhỏ'),
            const SizedBox(width: 16),
            button(Icons.zoom_in, 'zoomIn', 'Phóng to'),
          ],
        ),
      ],
    );
  }
}
