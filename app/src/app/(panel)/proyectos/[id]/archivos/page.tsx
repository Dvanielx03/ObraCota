import { FileLibrary } from "@/modules/model-file/ui/file-library";

export default async function Page({params}:{params:Promise<{id:string}>}) {
  return <FileLibrary project={(await params).id}/>;
}
