import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api/api_client.dart';
import '../domain/agent_message.dart';

final agentRepositoryProvider = Provider<AgentRepository>(
  (ref) => AgentRepository(ref.read(apiClientProvider)),
);

class AgentRepository {
  const AgentRepository(this.client);

  final ApiClient client;

  Future<List<AgentMessageRow>> history({int? since, int limit = 100}) async {
    final response = await client.request<Map<String, dynamic>>(
      '/api/agent/chat',
      queryParameters: {'limit': limit, 'since': ?since},
    );
    return (response.data!['messages'] as List<dynamic>? ?? [])
        .whereType<Map>()
        .map((row) => AgentMessageRow.fromJson(row.cast<String, dynamic>()))
        .toList(growable: false);
  }

  Future<AgentChatTurn> send({
    required List<AgentMessage> messages,
    String provider = 'auto',
    int? timezoneOffsetMinutes,
    Object? conversationContext,
  }) async {
    final response = await client.request<Map<String, dynamic>>(
      '/api/agent/chat',
      method: 'POST',
      data: {
        'messages': messages.map((message) => message.toJson()).toList(),
        'provider': provider,
        'timezoneOffsetMinutes': ?timezoneOffsetMinutes,
        'conversationContext': conversationContext,
      },
    );
    return AgentChatTurn.fromJson(response.data!);
  }

  Future<AgentChatTurn> confirm({
    required AgentProposal proposal,
    Object? conversationContext,
  }) async {
    final response = await client.request<Map<String, dynamic>>(
      '/api/agent/chat',
      method: 'POST',
      data: {
        'confirmedAction': proposal.toJson(),
        'conversationContext': conversationContext,
      },
    );
    return AgentChatTurn.fromJson(response.data!);
  }
}
