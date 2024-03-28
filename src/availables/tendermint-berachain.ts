import Tendermint from "./tendermint-v1";

export default class TendermintBerachain extends Tendermint {
    public constructor(protected readonly existMetrics: string,
                       protected readonly apiUrl: string,
                       protected readonly addresses: string,
                       protected readonly validator: string) {
        super(existMetrics, apiUrl, addresses, validator);
    }

    public async makeMetrics(): Promise<string> {
        await super.makeMetrics();

        let customMetrics = '';
        try {
            await Promise.all([
                await this.updateEvmAddressBalance(this.addresses),
            ]);
            customMetrics = await this.registry.metrics();
        } catch (e) {
            console.error('makeMetrics', e);
        }

        return customMetrics + '\n' + await this.loadExistMetrics();
    }

    protected async updateEvmAddressBalance(addresses: string): Promise<void> {
        /*
        curl http://testnet.1xp.vc:30501/ \
            -X POST \
            -H "Content-Type: application/json" \
            --data '{"method":"eth_getBalance","params":["0x7A9BA30E544D2B6F1CD11709E9F0A5C57A779E94", "latest"],"id":1,"jsonrpc":"2.0"}'
        */
        // {"jsonrpc":"2.0","id":1,"result":"0x20877c4cbd1f97ad78"}

        const evmAddresses = addresses.split(',').filter((address) => address.startsWith('0x'));
        for (const address of evmAddresses) {
            const balances = [
                {
                    url: `http://localhost:8545`,
                    selector: (json: any): { result: number } => {
                        json.result = this.hexToDecimal(json.result);
                        return json;
                    }
                }
            ];

            const available = await this.getEVMAmount(balances[0].url, address, balances[0].selector);
            this.availableGauge.labels(address, 'bera').set(available.amount);
        }
    }

    private hexToDecimal(hex: string): number {
        return parseInt(hex, 16);
    }

    protected async getEVMAmount(url: string, address: string, selector: (json: {}) => { result: number }): Promise<{
        amount: number
    }> {
        return this.post(url, {
            method: 'eth_getBalance',
            params: [address, 'latest']
        }, response => {
            const result = selector(response.data);
            result.result /= Math.pow(10, 18);
            return result;
        });
    }
}