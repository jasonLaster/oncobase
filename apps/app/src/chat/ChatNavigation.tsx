import { ChatConversationList } from "./ChatConversationList";
import { ChatProviders } from "./ChatProviders";

// Reading a document should not initialize the chat client or its providers.
export default function ChatNavigation() {
  return (
    <ChatProviders>
      <ChatConversationList />
    </ChatProviders>
  );
}
