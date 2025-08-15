import { nsClient } from "./base";

export type NsCustomerBasic = {
  id: number;
  isPerson?: boolean;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  email?: string;
  phone?: string;
};

export async function getCustomerBasic(customerInternalId: number) {
  const client = await nsClient();
  const { data } = await client.get(
    `/record/v1/customer/${customerInternalId}`
  );
  const out: NsCustomerBasic = {
    id: customerInternalId,
    isPerson: data?.isPerson ?? data?.isperson,
    firstName: data?.firstName ?? data?.firstname,
    lastName: data?.lastName ?? data?.lastname,
    companyName: data?.companyName ?? data?.companyname,
    email: data?.email,
    phone: data?.phone,
  };
  return out;
}
