import { StoredViewer } from "@/modules/model-version/ui/stored-viewer";

export default async function Page({params,searchParams}:{params:Promise<{id:string;version:string}>;searchParams:Promise<{anterior?:string}>}) {
  const {id,version}=await params;
  const {anterior}=await searchParams;
  const previous=typeof anterior==="string" && /^[\da-f-]{36}$/i.test(anterior)?anterior:undefined;
  return <StoredViewer key={id+version+(previous??"")} project={id} version={version} previous={previous}/>;
}
