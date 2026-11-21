import {ProjectChanges} from "@/modules/design-change/ui/project-changes";
export default async function Page({params}:{params:Promise<{id:string}>}){
  return <ProjectChanges project={(await params).id} budget/>;
}
