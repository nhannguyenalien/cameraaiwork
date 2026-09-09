import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:video_player/video_player.dart';

import '../../auth/data/session_store.dart';
import '../data/event_repository.dart';
import '../domain/camera_event.dart';

class EventDetailScreen extends ConsumerStatefulWidget {
  const EventDetailScreen({required this.event, super.key});
  final CameraEvent event;

  @override
  ConsumerState<EventDetailScreen> createState() => _EventDetailScreenState();
}

class _EventDetailScreenState extends ConsumerState<EventDetailScreen> {
  late final TextEditingController _noteController;
  late bool _acknowledged;
  VideoPlayerController? _video;
  Object? _videoError;
  bool _initializingVideo = false;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _acknowledged = widget.event.acknowledged;
    _noteController = TextEditingController(text: widget.event.note ?? '');
  }

  @override
  void dispose() {
    _noteController.dispose();
    _video?.dispose();
    super.dispose();
  }

  Future<void> _saveDetails() async {
    setState(() => _saving = true);
    try {
      await ref
          .read(eventRepositoryProvider)
          .updateEvent(
            widget.event.id,
            acknowledged: _acknowledged,
            note: _noteController.text,
          );
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Đã lưu sự kiện.')));
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.toString())));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _openVideo() async {
    if (_video != null || _initializingVideo) return;
    setState(() {
      _initializingVideo = true;
      _videoError = null;
    });
    try {
      final token = await ref.read(sessionStoreProvider).readToken();
      if (token == null || token.isEmpty) {
        throw StateError('Phiên đăng nhập đã hết hạn.');
      }
      final controller = VideoPlayerController.networkUrl(
        ref.read(eventRepositoryProvider).videoUri(widget.event.id),
        httpHeaders: {'Authorization': 'Bearer $token'},
      );
      await controller.initialize();
      if (!mounted) {
        await controller.dispose();
        return;
      }
      setState(() {
        _video = controller;
        _initializingVideo = false;
      });
      await controller.play();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _videoError = error;
        _initializingVideo = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final event = widget.event;
    return Scaffold(
      appBar: AppBar(title: Text('Sự kiện #${event.id}')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (event.hasImage)
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: ref
                  .watch(eventImageProvider(event.id))
                  .when(
                    data: (bytes) => Image.memory(bytes, fit: BoxFit.contain),
                    loading: () => const AspectRatio(
                      aspectRatio: 16 / 9,
                      child: Center(child: CircularProgressIndicator()),
                    ),
                    error: (error, _) => AspectRatio(
                      aspectRatio: 16 / 9,
                      child: Center(child: Text(error.toString())),
                    ),
                  ),
            ),
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  _InfoRow(label: 'Camera', value: event.camera),
                  _InfoRow(label: 'Loại', value: _typeLabel(event.type)),
                  _InfoRow(
                    label: 'Thời gian',
                    value: _dateLabel(event.timestamp),
                  ),
                  if (event.personLabel != null)
                    _InfoRow(label: 'Người', value: event.personLabel!),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Đã xác nhận'),
                    value: _acknowledged,
                    onChanged: _saving
                        ? null
                        : (value) => setState(() => _acknowledged = value),
                  ),
                  TextField(
                    controller: _noteController,
                    enabled: !_saving,
                    minLines: 2,
                    maxLines: 5,
                    maxLength: 2000,
                    decoration: const InputDecoration(
                      labelText: 'Ghi chú',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _saving ? null : _saveDetails,
                      icon: _saving
                          ? const SizedBox.square(
                              dimension: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.save_outlined),
                      label: const Text('Lưu trạng thái và ghi chú'),
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (event.hasVideo) ...[
            const SizedBox(height: 16),
            if (_video == null)
              FilledButton.icon(
                onPressed: _initializingVideo ? null : _openVideo,
                icon: _initializingVideo
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.play_arrow),
                label: Text(
                  _initializingVideo ? 'Đang tải video...' : 'Xem video',
                ),
              )
            else
              _VideoView(controller: _video!),
            if (_videoError != null) ...[
              const SizedBox(height: 8),
              Text(
                _videoError.toString(),
                textAlign: TextAlign.center,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
          ],
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 100, child: Text(label)),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

class _VideoView extends StatefulWidget {
  const _VideoView({required this.controller});
  final VideoPlayerController controller;

  @override
  State<_VideoView> createState() => _VideoViewState();
}

class _VideoViewState extends State<_VideoView> {
  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_refresh);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_refresh);
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    return Column(
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: AspectRatio(
            aspectRatio: controller.value.aspectRatio,
            child: VideoPlayer(controller),
          ),
        ),
        VideoProgressIndicator(controller, allowScrubbing: true),
        IconButton.filledTonal(
          onPressed: () => controller.value.isPlaying
              ? controller.pause()
              : controller.play(),
          icon: Icon(
            controller.value.isPlaying ? Icons.pause : Icons.play_arrow,
          ),
        ),
      ],
    );
  }
}

String _typeLabel(String type) => switch (type) {
  'motion' => 'Chuyển động',
  'person' => 'Phát hiện người',
  _ => type,
};

String _dateLabel(DateTime value) {
  final date = value.toLocal();
  String two(int number) => number.toString().padLeft(2, '0');
  return '${two(date.hour)}:${two(date.minute)} · ${two(date.day)}/${two(date.month)}/${date.year}';
}
