const day=new Intl.DateTimeFormat("es-CO",{day:"numeric",month:"short",year:"numeric"});
export const formatDay=(iso:string|null)=>{const date=iso?new Date(iso):null;return date&&!Number.isNaN(date.getTime())?day.format(date).replace(/\./g,""):"";};
