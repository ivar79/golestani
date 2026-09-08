<?php
namespace Tests\Feature;
use App\Models\Business;
use App\Models\User;
use App\Support\BusinessUrl;
use Endroid\QrCode\Builder\Builder;
use Endroid\QrCode\Writer\SvgWriter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;
class PhaseTwoAcceptanceTest extends TestCase
{
    use RefreshDatabase;
    private function account(string $role='business_owner'): User
    {
        $u=User::factory()->create(['phone'=>'09'.fake()->unique()->numerify('#########'),'is_active'=>true]);
        $u->assignRole($role);return $u;
    }
    private function data(): array
    {
        return ['name'=>'کافه تست','category'=>'کافه','services'=>['قهوه','صبحانه'],'description'=>'توضیحات واقعی',
            'phone'=>'09123456789','email'=>'owner@example.test','address'=>'خیابان اصلی','city'=>'تهران','neighborhood'=>'مرکز',
            'latitude'=>35.7,'longitude'=>51.4,'social_links'=>['instagram'=>'https://instagram.com/example']];
    }
    private function business(User $u, string $status='pending'): Business
    {
        return $u->businesses()->create($this->data()+['slug'=>'business-'.fake()->uuid(),'status'=>$status]);
    }
    public function test_owner_can_create_reload_update_and_clear_profile(): void
    {
        $u=$this->account('user');$this->actingAs($u);
        $created=$this->postJson('/api/businesses',$this->data())->assertCreated()->assertJsonPath('status','pending');
        $id=$created->json('id');$slug=$created->json('slug');
        $this->assertTrue($u->fresh()->hasRole('business_owner'));
        $this->getJson('/api/businesses/'.$id)->assertOk()->assertJsonPath('city','تهران')->assertJsonPath('services.1','صبحانه');
        $this->putJson('/api/businesses/'.$id,['name'=>'نام جدید','phone'=>null,'email'=>null,'address'=>null,'city'=>null,'neighborhood'=>null,'services'=>[],'social_links'=>[],'latitude'=>null,'longitude'=>null])->assertOk()->assertJsonPath('slug',$slug);
        $this->getJson('/api/businesses/'.$id)->assertOk()->assertJsonPath('phone',null)->assertJsonPath('latitude',null)->assertJsonPath('services',[]);
        $this->assertDatabaseHas('businesses',['id'=>$id,'name'=>'نام جدید','phone'=>null]);
        $this->assertDatabaseHas('audit_events',['event'=>'business.created','subject_id'=>$id]);
        $this->assertDatabaseHas('audit_events',['event'=>'business.updated','subject_id'=>$id]);
    }
    public function test_admin_all_states_and_badges_and_public_visibility(): void
    {
        $b=$this->business($this->account());$this->actingAs($this->account('admin'));
        $this->patchJson('/api/admin/businesses/'.$b->id.'/moderate',['status'=>'approved','badges'=>['verified','trusted']])->assertOk();
        $this->getJson('/api/public/businesses/'.$b->slug)->assertOk()->assertJsonPath('badges.0','verified')->assertJsonPath('address','خیابان اصلی')->assertJsonPath('social_links.instagram','https://instagram.com/example')->assertJsonMissingPath('user_id')->assertJsonMissingPath('moderation_note');
        $this->getJson('/api/admin/businesses?status=approved')->assertOk()->assertJsonPath('data.0.id',$b->id);
        foreach(['rejected','suspended'] as $status){
            $this->patchJson('/api/admin/businesses/'.$b->id.'/moderate',['status'=>$status,'moderation_note'=>'نیاز به بررسی'])->assertOk()->assertJsonPath('status',$status);
            $this->getJson('/api/public/businesses/'.$b->slug)->assertNotFound();
            $this->get('/api/public/businesses/'.$b->slug.'/qr')->assertNotFound();
        }
        $this->getJson('/api/admin/businesses/'.$b->id.'/audit')->assertOk()->assertJsonPath('data.0.event','business.moderated');
    }
    public function test_owner_cannot_lift_suspension_or_assign_badges(): void
    {
        $u=$this->account();$b=$this->business($u,'suspended');$b->update(['moderation_note'=>'تعلیق مدیر']);$this->actingAs($u);
        $this->putJson('/api/businesses/'.$b->id,['name'=>'ویرایش','status'=>'approved','badges'=>['verified']])->assertOk()->assertJsonPath('status','suspended')->assertJsonPath('moderation_note','تعلیق مدیر');
        $this->assertNotContains('verified',(array)$b->fresh()->badges);
        $this->patchJson('/api/admin/businesses/'.$b->id.'/moderate',['status'=>'approved'])->assertForbidden();
    }
    public function test_real_content_edit_unpublishes_but_unchanged_save_does_not(): void
    {
        $u=$this->account();$b=$this->business($u,'approved');$this->actingAs($u);
        $this->putJson('/api/businesses/'.$b->id,$this->data())->assertOk()->assertJsonPath('status','approved');
        $this->putJson('/api/businesses/'.$b->id,['name'=>'ویرایش جدید'])->assertOk()->assertJsonPath('status','pending');
        $this->getJson('/api/public/businesses/'.$b->slug)->assertNotFound();
    }
    public function test_images_are_owned_limited_and_not_subscription_gated(): void
    {
        Storage::fake('public');$u=$this->account();$b=$this->business($u);$this->actingAs($u);
        for($i=0;$i<5;$i++){
            $this->withHeader('X-Requested-With','XMLHttpRequest')->post('/api/businesses/'.$b->id.'/images',['image'=>UploadedFile::fake()->image('gallery.png')],['Content-Type'=>'multipart/form-data'])->assertCreated();
        }
        $this->post('/api/businesses/'.$b->id.'/images',['image'=>UploadedFile::fake()->image('overflow.png')],['Content-Type'=>'multipart/form-data'])->assertStatus(422);
        $this->getJson('/api/businesses/'.$b->id.'/images')->assertOk()->assertJsonCount(5);
        $this->assertCount(5,Storage::disk('public')->allFiles());
        $image=$b->images()->firstOrFail();
        $this->deleteJson('/api/businesses/'.$b->id.'/images/'.$image->id)->assertOk();
        $this->assertCount(4,Storage::disk('public')->allFiles());
        $this->assertDatabaseHas('audit_events',['event'=>'business.image_deleted','subject_id'=>$b->id]);
    }
    public function test_logo_and_cover_upload_and_public_gallery(): void
    {
        Storage::fake('public');$u=$this->account();$b=$this->business($u,'approved');$this->actingAs($u);
        $this->withHeader('X-Requested-With','XMLHttpRequest')->post('/api/businesses/'.$b->id.'/upload',['logo'=>UploadedFile::fake()->image('logo.png'),'cover_image'=>UploadedFile::fake()->image('cover.jpg')],['Content-Type'=>'multipart/form-data'])->assertOk()->assertJsonPath('status','pending');
        $b->refresh();$this->assertStringStartsWith('/storage/businesses/logos/',$b->logo);
        $this->post('/api/businesses/'.$b->id.'/images',['image'=>UploadedFile::fake()->image('gallery.png')],['Content-Type'=>'multipart/form-data'])->assertCreated();
        $this->actingAs($this->account('admin'));
        $this->patchJson('/api/admin/businesses/'.$b->id.'/moderate',['status'=>'approved'])->assertOk();
        $this->getJson('/api/public/businesses/'.$b->slug)->assertOk()->assertJsonCount(1,'images')->assertJsonPath('logo',$b->logo);
    }
    public function test_qr_encodes_configured_frontend_not_api_origin(): void
    {
        config(['business.frontend_url'=>'https://site.example.test','app.url'=>'https://api.example.test']);
        $b=$this->business($this->account(),'approved');
        $url='https://site.example.test/b/'.$b->slug;
        $this->assertSame($url,BusinessUrl::public($b));
        $expected=(new Builder(data:$url,writer:new SvgWriter(),size:400,margin:10))->build()->getString();
        $response=$this->get('/api/public/businesses/'.$b->slug.'/qr')->assertOk()->assertHeader('Content-Type','image/svg+xml');
        $this->assertSame($expected,$response->getContent());
        $this->assertStringContainsString('.svg',$response->headers->get('Content-Disposition'));
    }
    public function test_audit_is_transactional_and_has_no_private_values(): void
    {
        $u=$this->account();$this->actingAs($u);
        $r=$this->postJson('/api/businesses',$this->data())->assertCreated();
        $metadata=DB::table('audit_events')->where('subject_id',$r->json('id'))->value('metadata');
        $this->assertStringNotContainsString('09123456789',$metadata);
        $this->assertStringNotContainsString('owner@example.test',$metadata);
        $this->assertStringNotContainsString('خیابان اصلی',$metadata);
        $before=DB::table('audit_events')->count();
        $this->postJson('/api/businesses',['name'=>''])->assertUnprocessable();
        $this->assertSame($before,DB::table('audit_events')->count());
        $this->deleteJson('/api/businesses/'.$r->json('id'))->assertOk();
        $this->assertDatabaseHas('audit_events',['event'=>'business.deleted','subject_id'=>$r->json('id')]);
    }
}
