<?php
namespace Tests\Security;
use App\Models\Business;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;
class PhaseTwoSecurityTest extends TestCase
{
    use RefreshDatabase;
    private function owner(): User
    {
        $u=User::factory()->create(['phone'=>'09'.fake()->unique()->numerify('#########'),'is_active'=>true]);$u->assignRole('business_owner');return $u;
    }
    private function b(User $u):Business{return $u->businesses()->create(['name'=>'امن','slug'=>fake()->uuid(),'status'=>'pending']);}
    public function test_unsafe_social_urls_are_rejected():void
    {
        $this->actingAs($this->owner());
        foreach(['javascript:alert(1)','data:text/html,<script>alert(1)</script>','//evil.example','https://user:pass@example.test','https://example.test/ bad'] as $url){
            $this->postJson('/api/businesses',['name'=>'نام','social_links'=>['website'=>$url]])->assertUnprocessable()->assertJsonValidationErrors('social_links.website');
        }
    }
    public function test_sql_input_is_bound_not_executed():void
    {
        $u=$this->owner();$this->actingAs($u);
        $payload="x' OR 1=1; DROP TABLE businesses; --";
        $r=$this->postJson('/api/businesses',['name'=>$payload])->assertCreated();
        $this->assertDatabaseHas('businesses',['id'=>$r->json('id'),'name'=>$payload]);
        $this->getJson('/api/search/businesses?'.http_build_query(['q'=>$payload]))->assertOk();
        $this->assertDatabaseCount('businesses',1);
    }
    public function test_cross_origin_json_and_simple_forms_are_rejected():void
    {
        config(['cors.allowed_origins'=>['https://app.example.test']]);
        $this->actingAs($this->owner());
        $this->withHeader('Origin','https://evil.example')->postJson('/api/businesses',['name'=>'CSRF'])->assertForbidden();
        $this->withHeader('Origin','https://app.example.test')->post('/api/businesses',['name'=>'CSRF'],['Content-Type'=>'application/x-www-form-urlencoded'])->assertStatus(415);
        $this->postJson('/api/businesses',['name'=>'Allowed'])->assertCreated();
    }
    public function test_cookie_only_authentication_does_not_authorize_api():void
    {
        $u=$this->owner();$this->be($u,'web');
        $this->postJson('/api/businesses',['name'=>'Cookie attack'])->assertUnauthorized();
    }
    public function test_real_bearer_token_can_create_profile():void
    {
        $u=$this->owner();$token=$u->createToken('test',['*'],now()->addHour())->plainTextToken;
        $this->withToken($token)->postJson('/api/businesses',['name'=>'Bearer'])->assertCreated();
    }
    public function test_idor_and_media_path_assignment_are_blocked():void
    {
        $owner=$this->owner();$other=$this->owner();$b=$this->b($owner);$this->actingAs($other);
        $this->getJson('/api/businesses/'.$b->id)->assertForbidden();
        $this->getJson('/api/businesses/'.$b->id.'/images')->assertForbidden();
        $this->putJson('/api/businesses/'.$b->id,['name'=>'سرقت'])->assertForbidden();
        $this->actingAs($owner);
        $this->putJson('/api/businesses/'.$b->id,['name'=>'امن','logo'=>'/storage/other-user.png'])->assertUnprocessable();
    }
    public function test_svg_and_non_image_uploads_are_rejected():void
    {
        Storage::fake('public');$u=$this->owner();$b=$this->b($u);$this->actingAs($u);
        foreach(['bad.svg'=>'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>','bad.jpg'=>'<?php echo 1; ?>'] as $name=>$contents){
            $this->withHeader('X-Requested-With','XMLHttpRequest')->post('/api/businesses/'.$b->id.'/images',['image'=>UploadedFile::fake()->createWithContent($name,$contents)],['Content-Type'=>'multipart/form-data'])->assertStatus(422);
        }
        $this->assertSame([],Storage::disk('public')->allFiles());
    }
    public function test_image_delete_is_scoped_to_parent_business():void
    {
        $u=$this->owner();$a=$this->b($u);$b=$this->b($u);$this->actingAs($u);
        $image=$b->images()->create(['path'=>'/storage/businesses/gallery/test.png']);
        $this->deleteJson('/api/businesses/'.$a->id.'/images/'.$image->id)->assertNotFound();
        $this->assertDatabaseHas('business_images',['id'=>$image->id]);
    }
    public function test_inactive_owner_cannot_mutate():void
    {
        $u=$this->owner();$u->update(['is_active'=>false]);$this->actingAs($u);
        $this->postJson('/api/businesses',['name'=>'ممنوع'])->assertForbidden();
    }
}
