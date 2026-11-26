import {DocumentAssistant} from "@/modules/chat-conversation/ui/document-assistant";

type Search = {version?:string|string[];element?:string|string[]};

export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Search>}){
  const [{id}, {version,element}] = await Promise.all([params,searchParams]);
  const piece=typeof version==="string" && typeof element==="string" && version && element
    ? {version,element} : undefined;
  return <DocumentAssistant key={JSON.stringify([id,piece])} project={id} piece={piece}/>;
}
