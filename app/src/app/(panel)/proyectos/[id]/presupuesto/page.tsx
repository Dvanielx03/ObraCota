import {ModelChanges} from "@/modules/model-change/ui/model-changes";
export default async function Page({params}:{params:Promise<{id:string}>}){
  return <ModelChanges project={(await params).id} budget/>;
}
