// Extractive summary: TF-IDF centroid for representativeness, MMR to avoid
// spending the three available excerpts on near-identical observations.
export function representativeNotes<T extends {text:string}>(notes:T[]):T[]{
  if(notes.length<=3)return notes;
  const documents=notes.map(note=>note.text.toLocaleLowerCase("es").match(/[\p{L}\p{N}]+/gu)??[]);
  const frequency=new Map<string,number>();
  for(const words of documents)for(const word of new Set(words))frequency.set(word,(frequency.get(word)??0)+1);
  const centroid=new Map<string,number>();
  const vectors=documents.map(words=>{
    const vector=new Map<string,number>();
    for(const word of words)vector.set(word,(vector.get(word)??0)+1);
    let squared=0;
    for(const [word,count] of vector){
      const weight=(1+Math.log(count))*Math.log(1+(documents.length/(frequency.get(word)??1)));
      vector.set(word,weight);squared+=weight*weight;
    }
    for(const [word,weight] of vector){
      const unit=weight/Math.sqrt(squared);vector.set(word,unit);centroid.set(word,(centroid.get(word)??0)+unit);
    }
    return vector;
  });
  const magnitude=Math.sqrt(Array.from(centroid.values()).reduce((n,w)=>n+w*w,0))||1;
  function dot(a:Map<string,number>,b:Map<string,number>){
    let result=0;for(const [word,value] of a)result+=value*(b.get(word)??0);return result;
  }
  const relevance=vectors.map(v=>dot(v,centroid)/magnitude);
  const chosen:number[]=[];
  while(chosen.length<3){
    let best=-1,bestScore=-Infinity;
    for(const [i,v] of vectors.entries()){
      if(chosen.includes(i) || chosen.some(j=>notes[j].text.trim()===notes[i].text.trim()))continue;
      const overlap=Math.max(0,...chosen.map(j=>dot(v,vectors[j])));
      const score=0.55*relevance[i]-0.45*overlap;
      if(score>bestScore){best=i;bestScore=score;}
    }
    if(best<0)break;
    chosen.push(best);
  }
  return chosen.map(i=>notes[i]);
}
