import { StoredViewer } from "@/modules/model-version/ui/stored-viewer";

export default async function Page({params}:{params:Promise<{id:string;version:string}>}) {
  const {id,version}=await params;
  return <StoredViewer key={id+version} project={id} version={version}/>;
}
