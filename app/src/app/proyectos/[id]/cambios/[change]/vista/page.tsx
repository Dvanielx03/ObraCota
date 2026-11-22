import { ProposalViewer } from "@/modules/model-change/ui/proposal-viewer";

export default async function Page({params}:{params:Promise<{id:string;change:string}>}) {
  const {id,change}=await params;
  return <ProposalViewer key={id+change} project={id} change={change}/>;
}
