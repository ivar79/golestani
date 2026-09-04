import api from "@/lib/api";
export type AdminOverview = { counts: Record<string, number>; queues: { businesses: Record<string, unknown>[]; subscriptions: Record<string, unknown>[]; showcases: Record<string, unknown>[]; advertisements: Record<string, unknown>[]; portfolios: Record<string, unknown>[] } };
export async function getAdminOverview() { return (await api.get<AdminOverview>("/admin/overview")).data; }
export async function moderateAdminBusiness(id:number,status:string){ return (await api.patch(`/admin/businesses/${id}/moderate`,{status})).data; }
export async function moderateAdminSubscription(id:number,status:string){ return (await api.patch(`/admin/subscriptions/${id}/moderate`,{status})).data; }
export async function moderateAdminShowcase(id:number,is_published:boolean){ return (await api.patch(`/admin/showcases/${id}/moderate`,{is_published})).data; }
export async function moderateAdminAdvertisement(id:number,status:string){ return (await api.patch(`/admin/advertisements/${id}/moderate`,{status})).data; }
export async function moderateAdminPortfolio(id:number,status:string){ return (await api.patch(`/admin/portfolios/${id}/moderate`,{status})).data; }
