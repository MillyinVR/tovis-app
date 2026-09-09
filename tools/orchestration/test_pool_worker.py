import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import pool_worker as p

PROMPT='x.ts:1: export type ConsultDTO = {}\nx.ts:2: const n = 2'
GOOD={'status':'complete','confidence':0.99,'findings':[{'claim':'DTO definition','evidence':[{'path':'x.ts','line':1,'quote':'export type ConsultDTO = {}'}]}],'missing':[]}
CONTRACT={'evidence':[['x.ts',1]],'claims':['DTO definition']}
CONFIG={'free':{'enabled':True,'model':'test/model:free','passed_classes':['symbol-search']},'hf':{'enabled':False,'model':None,'passed_classes':[]},'glm':{'enabled':True,'model':'z-ai/glm-5.3','passed_classes':['symbol-search']}}


class PoolTests(unittest.TestCase):
    def test_contract_rejects_missing_and_contradictory_claims(self):
        for contract in [None, {'evidence':[['x.ts',2]],'claims':['DTO definition']}, {'evidence':[['x.ts',1]],'claims':['No DTO definition exists']}]:
            with self.assertRaises(p.PoolError):p.validate_contract(GOOD,contract)
        p.validate_contract(GOOD,{'evidence':[['x.ts',1]],'claims':['DTO definition']})

    def test_invalid_contract_never_spends(self):
        with patch.object(p,'call') as call:
            self.assertEqual(p.dispatch('free',PROMPT,CONFIG,'symbol-search')['next_worker'],'astra')
            call.assert_not_called()

    def test_valid_evidence(self):
        self.assertEqual(p.validate_result(json.dumps(GOOD),PROMPT),GOOD)

    def test_rejects_malformed_incomplete_low_confidence_and_hallucinations(self):
        for field,value in [('status','incomplete'),('status','unsupported'),('missing',['file']),('confidence',0.5),('confidence',True),('confidence',float('nan')),('findings',[])]:
            bad=copy.deepcopy(GOOD);bad[field]=value
            with self.subTest(field=field,value=value), self.assertRaises(p.PoolError):p.validate_result(json.dumps(bad),PROMPT)
        for field,value in [('path','../../secret'),('line',2),('quote','invented')]:
            bad=copy.deepcopy(GOOD);bad['findings'][0]['evidence'][0][field]=value
            with self.subTest(field=field),self.assertRaises(p.PoolError):p.validate_result(json.dumps(bad),PROMPT)
        for raw in ['```json\n{}\n```','[]','null','not json']:
            with self.assertRaises(p.PoolError):p.validate_result(raw,PROMPT)

    def test_secret_screen_including_hf_and_known_key(self):
        for text in ['hf_'+'x'*25,'api_key='+'x'*25,'Bearer '+('y'*30)]:
            with self.assertRaises((p.PoolError,ValueError)):p.screen(text,['y'*30])

    def test_free_price_guard_rejects_paid_unknown_and_nonfinite(self):
        for model,prices in [('test/paid',{'prompt':'0','completion':'0'}),('test/model:free',{'prompt':'0.1','completion':'0'}),('test/model:free',{'prompt':'NaN','completion':'0'}),('test/model:free',{'prompt':'0'}),('test/model:free',{'prompt':'0','completion':'0','request':'1'})]:
            with patch.object(p,'http',return_value={'data':[{'id':model,'pricing':prices}]}),self.assertRaises(p.PoolError):p.openrouter_prices(model,'key',True)

    def test_paid_escalation_held_by_default(self):
        with patch.object(p,'call',side_effect=p.PoolError('Malformed JSON')) as call:
            r=p.dispatch('free',PROMPT,CONFIG,'symbol-search',contract=CONTRACT)
            self.assertEqual(r['next_worker'],'glm');self.assertEqual(call.call_count,1)

    def test_automatic_glm_then_senior_after_budget_authorized(self):
        with patch.object(p,'call',side_effect=[p.PoolError('Incomplete'),p.PoolError('Low confidence')]) as call:
            r=p.dispatch('free',PROMPT,CONFIG,'symbol-search',0.01,contract=CONTRACT)
            self.assertEqual(r['next_worker'],'claude/astra');self.assertEqual(call.call_count,2)

    def test_success_never_final(self):
        with patch.object(p,'call',return_value={'result':GOOD}):
            self.assertEqual(p.dispatch('free',PROMPT,CONFIG,'symbol-search',contract={'evidence':[['x.ts',1]],'claims':['DTO definition']})['status'],'needs_astra_verification')

    def test_high_risk_never_calls_worker(self):
        for kind in ['architecture','migration','privacy','security','concurrency','merge','ambiguous']:
            with patch.object(p,'call') as call:
                self.assertEqual(p.dispatch('free',PROMPT,CONFIG,kind)['next_worker'],'astra');call.assert_not_called()

    def test_router_requires_variability_opt_in(self):
        config=copy.deepcopy(CONFIG);config['free']['model']='openrouter/free'
        with patch.object(p,'call') as call:
            self.assertEqual(p.dispatch('free',PROMPT,config,'symbol-search',contract=CONTRACT)['next_worker'],'glm');call.assert_not_called()

    def test_no_paid_call_when_ceiling_exceeds_budget(self):
        with patch.object(p,'credential',return_value='testkey'),patch.object(p,'openrouter_prices',return_value={'prompt':p.Decimal('0.1'),'completion':p.Decimal('0.1')}),patch.object(p,'http') as http:
            with self.assertRaises(p.PoolError):p.call('glm','z-ai/glm-5.3',PROMPT,{},0.001)
            http.assert_not_called()

    def test_no_hf_inference_even_with_token(self):
        with patch.object(p,'credential',return_value='testkey'),patch.object(p,'http') as http:
            with self.assertRaises(p.PoolError):p.call('hf','test/model',PROMPT,{})
            http.assert_not_called()

    def test_free_request_has_zero_price_and_no_tools(self):
        response={'model':'test/model:free','choices':[{'finish_reason':'stop','message':{'content':json.dumps(GOOD)}}],'usage':{'cost':0}}
        with patch.object(p,'credential',return_value='testkey'),patch.object(p,'openrouter_prices',return_value={'prompt':p.Decimal(0),'completion':p.Decimal(0)}),patch.object(p,'http',return_value=response) as http:
            p.call('free','test/model:free',PROMPT,{})
            body=http.call_args.args[2]
            self.assertEqual(set(body),{'model','messages','max_tokens','temperature','stream','provider'})
            self.assertTrue(all(v==0 for v in body['provider']['max_price'].values()))
            self.assertFalse(body['provider']['allow_fallbacks'])

    def test_truncation_and_tool_output_rejected(self):
        for response in [{'choices':[{'finish_reason':'length','message':{'content':json.dumps(GOOD)}}]}, {'choices':[{'finish_reason':'stop','message':{'content':json.dumps(GOOD),'tool_calls':[{}]}}]}]:
            with patch.object(p,'credential',return_value='testkey'),patch.object(p,'openrouter_prices',return_value={'prompt':p.Decimal(0),'completion':p.Decimal(0)}),patch.object(p,'http',return_value=response),self.assertRaises(p.PoolError):p.call('free','test/model:free',PROMPT,{})

if __name__=='__main__':unittest.main()
