import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../events/data/event_repository.dart';
import '../../events/domain/camera_event.dart';
import '../data/camera_repository.dart';
import '../domain/camera.dart';

/// How long before a live session expires to silently start a new one.
const _liveSessionRenewMargin = Duration(seconds: 20);

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
  Timer? _renewTimer;

  @override
  void dispose() {
    _renewTimer?.cancel();
    super.dispose();
  }

  Future<void> _startLive() async {
    _renewTimer?.cancel();
    setState(() {
      _startingLive = true;
      _actionError = null;
    });
    try {
      final session = await ref
          .read(cameraRepositoryProvider)
          .createLiveSession(widget.camera);
      final controller = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted);
      try {
        // webview_flutter_wkwebview has no macOS implementation of
        // setOpaque, which setBackgroundColor calls under the hood —
        // it always throws UnimplementedError there.
        await controller.setBackgroundColor(Colors.black);
      } on UnimplementedError {
        // Safe to ignore: WKWebView on macOS already renders opaque.
      }
      await controller.loadRequest(session.url);
      if (!mounted) return;
      setState(() {
        _liveSession = session;
        _liveController = controller;
      });
      final renewIn =
          session.expiresAt.difference(DateTime.now().toUtc()) -
          _liveSessionRenewMargin;
      _renewTimer = Timer(renewIn.isNegative ? Duration.zero : renewIn, () {
        if (mounted) _startLive();
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
    ref.invalidate(cameraEventsProvider(widget.camera.stream));
    ref.invalidate(cameraTimelineEventsProvider);
  }

  @override
  Widget build(BuildContext context) {
    final status = ref.watch(cameraStatusProvider(widget.camera));
    final snapshot = ref.watch(cameraSnapshotProvider(widget.camera));
    final events = ref.watch(cameraEventsProvider(widget.camera.stream));
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
          const SizedBox(height: 24),
          _CameraTimeline(camera: widget.camera),
          const SizedBox(height: 24),
          Text(
            'Sự kiện gần đây',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          events.when(
            loading: () => const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Center(child: CircularProgressIndicator()),
            ),
            error: (error, _) => Card(
              child: ListTile(
                leading: const Icon(Icons.cloud_off, color: Colors.red),
                title: const Text('Không lấy được sự kiện'),
                subtitle: Text(error.toString()),
              ),
            ),
            data: (items) => items.isEmpty
                ? const Padding(
                    padding: EdgeInsets.symmetric(vertical: 16),
                    child: Center(child: Text('Chưa có sự kiện nào.')),
                  )
                : Column(
                    children: items
                        .map((event) => _CameraEventTile(event: event))
                        .toList(growable: false),
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

class _CameraTimeline extends ConsumerStatefulWidget {
  const _CameraTimeline({required this.camera});

  final CameraSummary camera;

  @override
  ConsumerState<_CameraTimeline> createState() => _CameraTimelineState();
}

class _CameraTimelineState extends ConsumerState<_CameraTimeline> {
  static const _zoomHours = [24, 12, 6, 3, 1];
  late DateTime _windowEnd;
  int _zoomIndex = 3;
  CameraEvent? _selectedEvent;

  @override
  void initState() {
    super.initState();
    _windowEnd = DateTime.now();
  }

  DateTime get _dayStart =>
      DateTime(_windowEnd.year, _windowEnd.month, _windowEnd.day);
  Duration get _windowDuration => Duration(hours: _zoomHours[_zoomIndex]);
  DateTime get _windowStart {
    final candidate = _windowEnd.subtract(_windowDuration);
    return candidate.isBefore(_dayStart) ? _dayStart : candidate;
  }

  Future<void> _pickDateTime() async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: _windowEnd,
      firstDate: DateTime(now.year - 2),
      lastDate: now,
      helpText: 'Chọn ngày xem timeline',
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(_windowEnd),
      helpText: 'Chọn giờ kết thúc timeline',
    );
    if (time == null) return;
    var value = DateTime(
      date.year,
      date.month,
      date.day,
      time.hour,
      time.minute,
    );
    if (value.isAfter(now)) value = now;
    setState(() {
      _windowEnd = value;
      _selectedEvent = null;
    });
  }

  void _changeZoom(int delta) {
    final next = (_zoomIndex + delta).clamp(0, _zoomHours.length - 1);
    if (next == _zoomIndex) return;
    setState(() => _zoomIndex = next);
  }

  void _goNow() {
    setState(() {
      _windowEnd = DateTime.now();
      _selectedEvent = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final query = CameraTimelineQuery(
      cameraStream: widget.camera.stream,
      dayStart: _dayStart,
    );
    final events = ref.watch(cameraTimelineEventsProvider(query));
    final colors = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                'Dòng thời gian',
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            TextButton.icon(
              onPressed: _goNow,
              icon: const Icon(Icons.schedule, size: 18),
              label: const Text('Bây giờ'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Card(
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _pickDateTime,
                        icon: const Icon(Icons.calendar_month),
                        label: Text(_dateTimeLabel(_windowEnd)),
                      ),
                    ),
                    const SizedBox(width: 8),
                    IconButton.outlined(
                      onPressed: _zoomIndex == 0 ? null : () => _changeZoom(-1),
                      tooltip: 'Thu nhỏ timeline',
                      icon: const Icon(Icons.remove),
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      child: Text(
                        '${_zoomHours[_zoomIndex]}h',
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ),
                    IconButton.outlined(
                      onPressed: _zoomIndex == _zoomHours.length - 1
                          ? null
                          : () => _changeZoom(1),
                      tooltip: 'Phóng to timeline',
                      icon: const Icon(Icons.add),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                events.when(
                  loading: () => const SizedBox(
                    height: 112,
                    child: Center(child: CircularProgressIndicator()),
                  ),
                  error: (error, _) => SizedBox(
                    height: 112,
                    child: Center(
                      child: Text('Không tải được timeline: $error'),
                    ),
                  ),
                  data: (items) => _buildTimeline(context, items, colors),
                ),
                if (_selectedEvent case final event?) ...[
                  const SizedBox(height: 12),
                  InkWell(
                    onTap: () => context.push('/event', extra: event),
                    borderRadius: BorderRadius.circular(12),
                    child: Ink(
                      decoration: BoxDecoration(
                        color: colors.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Row(
                        children: [
                          ClipRRect(
                            borderRadius: const BorderRadius.horizontal(
                              left: Radius.circular(12),
                            ),
                            child: SizedBox(
                              width: 120,
                              height: 76,
                              child: event.hasImage
                                  ? ref
                                        .watch(eventImageProvider(event.id))
                                        .when(
                                          data: (bytes) => Image.memory(
                                            bytes,
                                            fit: BoxFit.cover,
                                          ),
                                          loading: () => const Center(
                                            child: CircularProgressIndicator(
                                              strokeWidth: 2,
                                            ),
                                          ),
                                          error: (_, _) => const Icon(
                                            Icons.broken_image_outlined,
                                          ),
                                        )
                                  : const Icon(
                                      Icons.image_not_supported_outlined,
                                    ),
                            ),
                          ),
                          Expanded(
                            child: Padding(
                              padding: const EdgeInsets.all(10),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    event.personLabel ?? event.typeLabel,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(eventDateLabel(event.timestamp)),
                                ],
                              ),
                            ),
                          ),
                          const Padding(
                            padding: EdgeInsets.only(right: 8),
                            child: Icon(Icons.chevron_right),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildTimeline(
    BuildContext context,
    List<CameraEvent> allEvents,
    ColorScheme colors,
  ) {
    final start = _windowStart;
    final end = _windowEnd;
    final durationMs = end.difference(start).inMilliseconds;
    final visible = allEvents.where((event) {
      final local = event.timestamp.toLocal();
      return !local.isBefore(start) && local.isBefore(end);
    }).toList()..sort((a, b) => a.timestamp.compareTo(b.timestamp));
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        return Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  _timeLabel(start),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                Text(
                  _timeLabel(end),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
            const SizedBox(height: 6),
            SizedBox(
              height: 54,
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  Positioned.fill(
                    top: 13,
                    bottom: 13,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: colors.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(9),
                      ),
                    ),
                  ),
                  for (final event in visible)
                    Positioned(
                      left:
                          ((event.timestamp
                                          .toLocal()
                                          .difference(start)
                                          .inMilliseconds /
                                      durationMs) *
                                  (width - 16))
                              .clamp(0, width - 16),
                      top: 10,
                      child: Semantics(
                        label:
                            '${event.typeLabel}, ${eventDateLabel(event.timestamp)}',
                        button: true,
                        child: GestureDetector(
                          onTap: () => setState(() => _selectedEvent = event),
                          child: AnimatedContainer(
                            duration: const Duration(milliseconds: 120),
                            width: 16,
                            height: 34,
                            decoration: BoxDecoration(
                              color: event.type == 'Vehicle'
                                  ? Colors.orange
                                  : colors.primary,
                              borderRadius: BorderRadius.circular(6),
                              border: _selectedEvent?.id == event.id
                                  ? Border.all(
                                      color: colors.onSurface,
                                      width: 2,
                                    )
                                  : null,
                            ),
                          ),
                        ),
                      ),
                    ),
                  if (visible.isEmpty)
                    const Positioned.fill(
                      child: Center(
                        child: Text('Không có đoạn ghi hình trong khoảng này'),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 4),
            const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.touch_app, size: 16),
                SizedBox(width: 4),
                Text('Chạm vào đoạn ghi hình để xem snapshot'),
              ],
            ),
          ],
        );
      },
    );
  }

  String _dateTimeLabel(DateTime value) =>
      '${value.day.toString().padLeft(2, '0')}/${value.month.toString().padLeft(2, '0')}/${value.year} · ${_timeLabel(value)}';
  String _timeLabel(DateTime value) =>
      '${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';
}

class _CameraEventTile extends ConsumerWidget {
  const _CameraEventTile({required this.event});
  final CameraEvent event;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Card(
      clipBehavior: Clip.antiAlias,
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        onTap: () => context.push('/event', extra: event),
        leading: SizedBox(
          width: 56,
          height: 56,
          child: event.hasImage
              ? ref
                    .watch(eventImageProvider(event.id))
                    .when(
                      data: (bytes) => Image.memory(bytes, fit: BoxFit.cover),
                      loading: () => const Center(
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                      error: (_, _) => const Icon(Icons.broken_image_outlined),
                    )
              : const ColoredBox(
                  color: Color(0xFFE8EAED),
                  child: Icon(Icons.image_not_supported_outlined),
                ),
        ),
        title: Text(event.personLabel ?? event.typeLabel),
        subtitle: Text(eventDateLabel(event.timestamp)),
        trailing: event.hasVideo ? const Icon(Icons.play_circle_outline) : null,
      ),
    );
  }
}
