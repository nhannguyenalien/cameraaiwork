import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:video_player/video_player.dart';

import '../../auth/data/session_store.dart';
import '../../events/data/event_repository.dart';
import '../data/agent_repository.dart';
import '../domain/agent_message.dart';

class AgentChatScreen extends ConsumerStatefulWidget {
  const AgentChatScreen({super.key});

  @override
  ConsumerState<AgentChatScreen> createState() => _AgentChatScreenState();
}

class _AgentChatScreenState extends ConsumerState<AgentChatScreen> {
  final _entries = <_ChatEntry>[];
  final _controller = TextEditingController();
  final _scrollController = ScrollController();
  Object? _conversationContext;
  bool _loadingHistory = true;
  bool _sending = false;
  Object? _historyError;

  @override
  void initState() {
    super.initState();
    _loadHistory();
  }

  @override
  void dispose() {
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadHistory() async {
    setState(() {
      _loadingHistory = true;
      _historyError = null;
    });
    try {
      final rows = await ref.read(agentRepositoryProvider).history(limit: 100);
      if (!mounted) return;
      setState(() {
        _entries
          ..clear()
          ..addAll(rows.map(_ChatEntry.fromRow));
        _loadingHistory = false;
      });
      _scrollToBottom();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _historyError = error;
        _loadingHistory = false;
      });
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
    });
  }

  List<AgentMessage> _recentContext() {
    final relevant = _entries.where((entry) => !entry.isError).toList();
    final recent = relevant.length > 20
        ? relevant.sublist(relevant.length - 20)
        : relevant;
    return recent
        .map((entry) => AgentMessage(role: entry.role, content: entry.content))
        .toList();
  }

  Future<void> _send() async {
    final text = _controller.text.trim();
    if (text.isEmpty || _sending) return;
    _controller.clear();
    setState(() {
      _entries.add(_ChatEntry.user(text));
      _sending = true;
    });
    _scrollToBottom();
    try {
      final turn = await ref
          .read(agentRepositoryProvider)
          .send(
            messages: _recentContext(),
            conversationContext: _conversationContext,
          );
      if (!mounted) return;
      setState(() {
        _conversationContext = turn.conversationContext;
        _entries.add(_ChatEntry.assistant(turn));
        _sending = false;
      });
      _scrollToBottom();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _entries.add(_ChatEntry.error(error.toString()));
        _sending = false;
      });
      _scrollToBottom();
    }
  }

  Future<void> _confirm(_ChatEntry entry, AgentProposal proposal) async {
    setState(() => entry.confirming = true);
    try {
      final turn = await ref
          .read(agentRepositoryProvider)
          .confirm(
            proposal: proposal,
            conversationContext: _conversationContext,
          );
      if (!mounted) return;
      setState(() {
        entry.confirming = false;
        entry.confirmed = true;
        _conversationContext = turn.conversationContext;
        _entries.add(_ChatEntry.assistant(turn));
      });
      _scrollToBottom();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        entry.confirming = false;
        _entries.add(_ChatEntry.error(error.toString()));
      });
      _scrollToBottom();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Trợ lý AI'),
        actions: [
          IconButton(
            tooltip: 'Làm mới',
            onPressed: _loadingHistory ? null : _loadHistory,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(child: _buildBody()),
          if (_sending)
            const LinearProgressIndicator(minHeight: 2)
          else
            const SizedBox(height: 2),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      minLines: 1,
                      maxLines: 4,
                      maxLength: 4000,
                      decoration: const InputDecoration(
                        hintText: 'Nhắn tin cho trợ lý...',
                        border: OutlineInputBorder(),
                        counterText: '',
                      ),
                      onSubmitted: (_) => _send(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: _sending ? null : _send,
                    icon: const Icon(Icons.send),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBody() {
    if (_loadingHistory) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_historyError != null) {
      return _ErrorView(error: _historyError!, onRetry: _loadHistory);
    }
    if (_entries.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'Hỏi trợ lý về camera, sự kiện, hoặc yêu cầu điều khiển hệ thống.',
            textAlign: TextAlign.center,
          ),
        ),
      );
    }
    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.all(12),
      itemCount: _entries.length,
      itemBuilder: (context, index) {
        final entry = _entries[index];
        return _EntryBubble(
          entry: entry,
          onConfirm: (proposal) => _confirm(entry, proposal),
        );
      },
    );
  }
}

class _ChatEntry {
  _ChatEntry._({
    required this.role,
    required this.content,
    this.proposals = const [],
    this.attachments = const [],
    this.isPatrol = false,
    this.isError = false,
  });

  final String role;
  final String content;
  final List<AgentProposal> proposals;
  final List<AgentAttachment> attachments;
  final bool isPatrol;
  final bool isError;
  bool confirming = false;
  bool confirmed = false;

  factory _ChatEntry.user(String text) =>
      _ChatEntry._(role: 'user', content: text);

  factory _ChatEntry.assistant(AgentChatTurn turn) => _ChatEntry._(
    role: 'assistant',
    content: turn.answer,
    proposals: turn.proposals,
    attachments: turn.attachments,
  );

  factory _ChatEntry.error(String message) =>
      _ChatEntry._(role: 'assistant', content: message, isError: true);

  factory _ChatEntry.fromRow(AgentMessageRow row) => _ChatEntry._(
    role: row.role,
    content: row.content,
    isPatrol: row.isPatrol,
  );
}

class _EntryBubble extends StatelessWidget {
  const _EntryBubble({required this.entry, required this.onConfirm});

  final _ChatEntry entry;
  final ValueChanged<AgentProposal> onConfirm;

  @override
  Widget build(BuildContext context) {
    final isUser = entry.role == 'user';
    final theme = Theme.of(context);
    final bubbleColor = entry.isError
        ? theme.colorScheme.errorContainer
        : isUser
        ? theme.colorScheme.primaryContainer
        : entry.isPatrol
        ? theme.colorScheme.tertiaryContainer
        : theme.colorScheme.surfaceContainerHighest;
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * 0.8,
        ),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: bubbleColor,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (entry.isPatrol)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(
                  'CẢNH BÁO TỰ ĐỘNG',
                  style: theme.textTheme.labelSmall,
                ),
              ),
            Text(entry.content),
            if (entry.attachments.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: entry.attachments
                    .map(
                      (attachment) =>
                          _AttachmentPreview(attachment: attachment),
                    )
                    .toList(),
              ),
            ],
            for (final proposal in entry.proposals)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: FilledButton.tonalIcon(
                  onPressed: entry.confirming || entry.confirmed
                      ? null
                      : () => onConfirm(proposal),
                  icon: entry.confirming
                      ? const SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Icon(
                          entry.confirmed
                              ? Icons.check
                              : Icons.warning_amber_outlined,
                        ),
                  label: Text(
                    entry.confirmed ? 'Đã xác nhận' : 'Xác nhận: ${proposal.action}',
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _AttachmentPreview extends ConsumerWidget {
  const _AttachmentPreview({required this.attachment});
  final AgentAttachment attachment;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (attachment.isImage) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: SizedBox(
          width: 140,
          height: 100,
          child: ref
              .watch(eventImageProvider(attachment.eventId))
              .when(
                data: (bytes) => Image.memory(bytes, fit: BoxFit.cover),
                loading: () => const Center(
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
                error: (_, _) => const Icon(Icons.broken_image_outlined),
              ),
        ),
      );
    }
    return _AgentVideoAttachment(eventId: attachment.eventId);
  }
}

class _AgentVideoAttachment extends ConsumerStatefulWidget {
  const _AgentVideoAttachment({required this.eventId});
  final int eventId;

  @override
  ConsumerState<_AgentVideoAttachment> createState() =>
      _AgentVideoAttachmentState();
}

class _AgentVideoAttachmentState
    extends ConsumerState<_AgentVideoAttachment> {
  VideoPlayerController? _controller;
  bool _loading = false;
  Object? _error;

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (_controller != null || _loading) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final token = await ref.read(sessionStoreProvider).readToken();
      if (token == null || token.isEmpty) {
        throw StateError('Phiên đăng nhập đã hết hạn.');
      }
      final controller = VideoPlayerController.networkUrl(
        ref.read(eventRepositoryProvider).videoUri(widget.eventId),
        httpHeaders: {'Authorization': 'Bearer $token'},
      );
      await controller.initialize();
      if (!mounted) {
        await controller.dispose();
        return;
      }
      setState(() {
        _controller = controller;
        _loading = false;
      });
      await controller.play();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    if (controller != null) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: SizedBox(
          width: 200,
          child: AspectRatio(
            aspectRatio: controller.value.aspectRatio,
            child: VideoPlayer(controller),
          ),
        ),
      );
    }
    return SizedBox(
      width: 140,
      height: 100,
      child: Material(
        color: Colors.black12,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: _loading ? null : _load,
          child: Center(
            child: _loading
                ? const CircularProgressIndicator(strokeWidth: 2)
                : _error != null
                ? const Icon(Icons.error_outline)
                : const Icon(Icons.play_circle_outline, size: 32),
          ),
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.error, required this.onRetry});
  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off, size: 48),
            const SizedBox(height: 12),
            Text(error.toString(), textAlign: TextAlign.center),
            const SizedBox(height: 12),
            FilledButton(onPressed: onRetry, child: const Text('Thử lại')),
          ],
        ),
      ),
    );
  }
}
