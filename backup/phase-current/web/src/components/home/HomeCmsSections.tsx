"use client";
import { useEffect, useState } from "react";
import { getHomepageContent } from "@/lib/businesses";
export default function HomeCmsSections({slot}:{slot:string}){const [content,setContent]=useState<Record<string,string>>({});useEffect(()=>{getHomepageContent().then(setContent).catch(()=>undefined)},[]);return <>{content[`homepage.${slot}`] ?? ""}</>}
