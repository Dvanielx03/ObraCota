import {DocumentAssistant} from "@/modules/chat-conversation/ui/document-assistant";
export default async function Page({params}:{params:Promise<{id:string}>}){
  return <DocumentAssistant project={(await params).id}/>;
}
