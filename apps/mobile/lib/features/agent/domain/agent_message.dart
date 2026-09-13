// Postgres BIGINT/COUNT columns are serialized as JSON strings, not
// numbers, to avoid precision loss — accept either representation.
int? _parseInt(Object? value) => switch (value) {
  final num v => v.toInt(),
  final String v => int.tryParse(v),
  _ => null,
};

/// A single turn sent to the LLM. The server does not remember prior turns
/// itself — the client resends its own trailing window every request.
class AgentMessage {
  const AgentMessage({required this.role, required this.content});

  final String role;
  final String content;

  Map<String, dynamic> toJson() => {'role': role, 'content': content};
}

/// A persisted chat row as returned by `GET /api/agent/chat`.
class AgentMessageRow {
  const AgentMessageRow({
    required this.id,
    required this.role,
    required this.content,
    required this.source,
    required this.createdAt,
  });

  final int id;
  final String role;
  final String content;
  final String source;
  final DateTime createdAt;

  bool get isPatrol => source == 'patrol';

  factory AgentMessageRow.fromJson(Map<String, dynamic> json) {
    final id = _parseInt(json['id']);
    final role = json['role']?.toString();
    final content = json['content']?.toString();
    final createdAt = DateTime.tryParse(json['created_at']?.toString() ?? '');
    if (id == null || role == null || content == null || createdAt == null) {
      throw const FormatException('Dữ liệu tin nhắn không hợp lệ');
    }
    return AgentMessageRow(
      id: id,
      role: role,
      content: content,
      source: json['source']?.toString() ?? 'chat',
      createdAt: createdAt,
    );
  }
}

/// A mutating action the agent wants to take, awaiting user confirmation.
class AgentProposal {
  const AgentProposal({required this.action, required this.args});

  final String action;
  final Map<String, dynamic> args;

  factory AgentProposal.fromJson(Map<String, dynamic> json) {
    final action = json['action']?.toString();
    if (action == null) {
      throw const FormatException('Đề xuất thao tác không hợp lệ');
    }
    return AgentProposal(
      action: action,
      args: json['args'] is Map
          ? (json['args'] as Map).cast<String, dynamic>()
          : const {},
    );
  }

  Map<String, dynamic> toJson() => {'action': action, 'args': args};
}

/// Real camera-event media the agent attached to its answer.
class AgentAttachment {
  const AgentAttachment({required this.eventId, required this.kind});

  final int eventId;
  final String kind;

  bool get isVideo => kind == 'video';
  bool get isImage => kind == 'image';

  factory AgentAttachment.fromJson(Map<String, dynamic> json) {
    final eventId = _parseInt(json['eventId']);
    final kind = json['kind']?.toString();
    if (eventId == null || kind == null) {
      throw const FormatException('Đính kèm không hợp lệ');
    }
    return AgentAttachment(eventId: eventId, kind: kind);
  }
}

/// The response to either a normal chat turn or a confirmed action.
class AgentChatTurn {
  const AgentChatTurn({
    required this.answer,
    this.provider,
    this.model,
    this.proposals = const [],
    this.attachments = const [],
    this.conversationContext,
  });

  final String answer;
  final String? provider;
  final String? model;
  final List<AgentProposal> proposals;
  final List<AgentAttachment> attachments;

  /// Opaque server-side state (e.g. the "identify people" wizard). Must be
  /// echoed back verbatim on the next request.
  final Object? conversationContext;

  factory AgentChatTurn.fromJson(Map<String, dynamic> json) {
    return AgentChatTurn(
      answer: json['answer']?.toString() ?? '',
      provider: json['provider']?.toString(),
      model: json['model']?.toString(),
      proposals: (json['proposals'] as List<dynamic>? ?? [])
          .whereType<Map>()
          .map((row) => AgentProposal.fromJson(row.cast<String, dynamic>()))
          .toList(growable: false),
      attachments: (json['attachments'] as List<dynamic>? ?? [])
          .whereType<Map>()
          .map((row) => AgentAttachment.fromJson(row.cast<String, dynamic>()))
          .toList(growable: false),
      conversationContext: json['conversationContext'],
    );
  }
}
